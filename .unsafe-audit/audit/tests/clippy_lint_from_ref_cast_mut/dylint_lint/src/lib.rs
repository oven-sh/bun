// =========================================================================
// dylint lint: dealloc_through_from_ref
//
// Late-pass lint. Fires on `dealloc(core::ptr::from_ref(_).cast_mut())` and
// its sister sinks (`heap::destroy`, `Box::from_raw`, `drop_in_place`,
// `mi_free`).
//
// Rationale: `from_ref` carries SharedReadOnly provenance under Stacked /
// Tree Borrows. Deallocating through a SharedReadOnly pointer is UB. The
// audit cluster U2 found 8 instances of this in Bun.
//
// Build & install:
//   $ cd .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/dylint_lint
//   $ cargo build --release
// Then from the Bun repo root:
//   $ cargo dylint --path . -- --all-targets
// =========================================================================

#![feature(rustc_private)]
#![warn(unused_extern_crates)]

extern crate rustc_ast;
extern crate rustc_hir;
extern crate rustc_lint;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use clippy_utils::diagnostics::span_lint_and_help;
use clippy_utils::{match_def_path, paths};
use rustc_hir::{Expr, ExprKind};
use rustc_lint::{LateContext, LateLintPass};
use rustc_session::{declare_lint, declare_lint_pass};

declare_lint! {
    /// ### What it does
    /// Catches deallocation through a `core::ptr::from_ref(_).cast_mut()` pointer.
    ///
    /// ### Why is this bad?
    /// `from_ref` carries `SharedReadOnly` provenance under Stacked Borrows
    /// and Tree Borrows. Using such a pointer to free the allocation
    /// (`heap::destroy`, `Box::from_raw`, `drop_in_place`, `dealloc`,
    /// `mi_free`) is undefined behavior.
    ///
    /// ### Example
    /// ```ignore
    /// // Bad — SharedReadOnly dealloc
    /// unsafe { bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut()) };
    ///
    /// // Good — retain the owning `*mut T` from the original allocation
    /// let href: *mut Href = bun_core::heap::into_raw(Box::new(href_value));
    /// // ... later ...
    /// unsafe { bun_core::heap::destroy(href) };
    /// ```
    pub DEALLOC_THROUGH_FROM_REF,
    Warn,
    "deallocation through a `from_ref(_).cast_mut()` pointer is UB"
}

declare_lint_pass!(DeallocThroughFromRef => [DEALLOC_THROUGH_FROM_REF]);

// Symbol paths for the dealloc-shaped sinks we lint on.
const SINKS: &[&[&str]] = &[
    // bun_core::heap::destroy
    &["bun_core", "heap", "destroy"],
    // alloc::boxed::Box::from_raw
    &["alloc", "boxed", "Box", "from_raw"],
    // std::boxed::Box::from_raw
    &["std", "boxed", "Box", "from_raw"],
    // core::ptr::drop_in_place
    &["core", "ptr", "drop_in_place"],
    &["std", "ptr", "drop_in_place"],
    // alloc::alloc::dealloc / std::alloc::dealloc
    &["alloc", "alloc", "dealloc"],
    &["std", "alloc", "dealloc"],
    // libmimalloc_sys::mi_free
    &["libmimalloc_sys", "mi_free"],
];

fn is_from_ref_cast_mut<'tcx>(cx: &LateContext<'tcx>, expr: &'tcx Expr<'tcx>) -> bool {
    // Pattern: <inner>.cast_mut(), where <inner> is core::ptr::from_ref(_).
    let ExprKind::MethodCall(seg, recv, _, _) = expr.kind else {
        return false;
    };
    if seg.ident.name.as_str() != "cast_mut" {
        return false;
    }
    let ExprKind::Call(fun, _args) = recv.kind else {
        return false;
    };
    let typeck = cx.typeck_results();
    let Some(def_id) = typeck.type_dependent_def_id(fun.hir_id) else {
        // Free function — resolve via path
        if let ExprKind::Path(qpath) = &fun.kind {
            if let Some(def_id) = typeck.qpath_res(qpath, fun.hir_id).opt_def_id() {
                return match_def_path(cx, def_id, &["core", "ptr", "from_ref"])
                    || match_def_path(cx, def_id, &["std", "ptr", "from_ref"]);
            }
        }
        return false;
    };
    match_def_path(cx, def_id, &["core", "ptr", "from_ref"])
        || match_def_path(cx, def_id, &["std", "ptr", "from_ref"])
}

fn arg_is_from_ref_cast_mut<'tcx>(
    cx: &LateContext<'tcx>,
    args: &'tcx [Expr<'tcx>],
) -> Option<usize> {
    args.iter().position(|a| {
        let mut cur = a;
        // Peel `as *mut u8` casts that wrap the expression
        while let ExprKind::Cast(inner, _ty) = cur.kind {
            cur = inner;
        }
        is_from_ref_cast_mut(cx, cur)
    })
}

impl<'tcx> LateLintPass<'tcx> for DeallocThroughFromRef {
    fn check_expr(&mut self, cx: &LateContext<'tcx>, expr: &'tcx Expr<'tcx>) {
        let ExprKind::Call(fun, args) = expr.kind else {
            return;
        };
        let typeck = cx.typeck_results();
        let def_id = match &fun.kind {
            ExprKind::Path(qpath) => typeck.qpath_res(qpath, fun.hir_id).opt_def_id(),
            _ => typeck.type_dependent_def_id(fun.hir_id),
        };
        let Some(def_id) = def_id else { return };
        if !SINKS.iter().any(|p| match_def_path(cx, def_id, p)) {
            return;
        }
        if arg_is_from_ref_cast_mut(cx, args).is_some() {
            span_lint_and_help(
                cx,
                DEALLOC_THROUGH_FROM_REF,
                expr.span,
                "deallocating through a `core::ptr::from_ref(_).cast_mut()` pointer is \
                 undefined behavior under Stacked / Tree Borrows",
                None,
                "retain the owning `*mut T` from the original allocation \
                 (`bun_core::heap::into_raw` / `Box::into_raw`) and free through \
                 that pointer instead; see audit/synthesis/refactor-clusters.md \
                 cluster U2 for the canonical fix template",
            );
        }
    }
}

// ── dylint registration entrypoint ──────────────────────────────────────
dylint_linting::dylint_library!();

#[allow(clippy::no_mangle_with_rust_abi)]
#[no_mangle]
pub fn register_lints(_sess: &rustc_session::Session, lint_store: &mut rustc_lint::LintStore) {
    lint_store.register_lints(&[DEALLOC_THROUGH_FROM_REF]);
    lint_store.register_late_pass(|_| Box::new(DeallocThroughFromRef));
}
