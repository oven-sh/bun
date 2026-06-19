// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Port of `react_compiler/entrypoint/program.rs` walking `bun_ast` directly.
//!
//! The compiler is invoked **per-function, post-visit** from the parser's
//! statement visitor (S::Function / S::Local / S::ExportDefault arms), after
//! `visit_stmts(body)` has consumed every `scopes_in_order` entry for that
//! body and resolved all identifier refs. JSX has been lowered to
//! `E::Call { was_jsx_element: true }`. The compiled body replaces the
//! original in place; a final `finish()` call emits the runtime import and
//! any outlined function decls as a separate `Part`.

use bun_alloc::{AstAlloc, AstVec};
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{
    self as ast, E, Expr, G, ImportKind, ImportRecord, Loc, Ref, S, Scope, Stmt, StmtOrExpr,
    StoreSlice, Symbol, b, flags,
};
use crate::diagnostics::{CompilerError, CompilerErrorOrDiagnostic, ErrorCategory};
use crate::hir::ReactFunctionType;
use crate::hir::environment_config::EnvironmentConfig;

use crate::ReactCompilerOptions;
use crate::codegen::CodegenFunction;

bun_core::declare_scope!(react_compiler, hidden);
use crate::compile_result::{CompileDiagnostic, CompileOutput};
use crate::imports::{ProgramContext, add_imports_to_program, validate_restricted_imports};
use crate::lowering::FunctionNode;
use crate::pipeline;

/// JSX runtime symbols the compiler may need to reference in generated code.
/// Mirrors `bun_js_parser::JSXImport` without the crate dependency.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JsxImportKind {
    Jsx,
    Jsxs,
    JsxDEV,
    Fragment,
    CreateElement,
}

/// Parser-side state the React Compiler needs. Implemented by `P` at the
/// hook site so this crate stays free of a `bun_js_parser` dependency.
///
/// Getters borrow `&self`; mutators borrow `&mut self`. Lowering uses only
/// getters and finishes (returning an owned `HirFunction`) before codegen
/// takes any `&mut self`, so the two never overlap.
pub trait Host {
    fn symbols(&self) -> &[Symbol];
    fn module_scope(&self) -> &Scope;
    fn import_records(&self) -> &[ImportRecord];
    fn source(&self) -> &[u8];
    fn arena(&self) -> &bun_alloc::Arena;

    /// Name bytes for any `Ref`, regardless of tag (`Symbol`,
    /// `SourceContentsSlice`, `AllocatedName`). Post-visit, identifier
    /// references are resolved `Symbol` refs, so this is just a symbol-table
    /// name lookup; kept for the few `SourceContentsSlice` refs codegen mints.
    fn ref_name(&self, ref_: Ref) -> &[u8];

    /// The `Scope` created at `loc`, if any. Unused post-visit (refs are
    /// already resolved); always returning `None` is correct.
    fn scope_for_loc(&self, loc: bun_ast::Loc) -> Option<&Scope>;

    /// `Ref` for a JSX runtime symbol (jsx/jsxs/jsxDEV/Fragment/createElement),
    /// declaring it on the parser's `jsx_imports` table on first use so the
    /// post-visit JSX-import emission picks it up.
    fn jsx_import(&mut self, kind: JsxImportKind) -> Ref;

    /// Whether JSX is being compiled in development mode (selects `jsxDEV`
    /// over `jsx`/`jsxs` and emits the trailing dev-only call args).
    fn is_jsx_dev(&self) -> bool {
        false
    }

    fn new_generated(&mut self, name: &[u8]) -> Ref;
    fn record_usage(&mut self, ref_: Ref);
    fn add_import_record(&mut self, path: &[u8], kind: ImportKind) -> (u32, Ref);
}

// Back-compat alias for the parser hook written against the previous API.
pub use Host as SymbolHost;

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

/// Directives that opt a function into memoization
const OPT_IN_DIRECTIVES: &[&[u8]] = &[b"use forget", b"use memo"];

/// Directives that opt a function out of memoization
const OPT_OUT_DIRECTIVES: &[&[u8]] = &[b"use no forget", b"use no memo"];

// -----------------------------------------------------------------------
// Directive helpers
// -----------------------------------------------------------------------

fn collect_body_directives(stmts: &[Stmt]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    for s in stmts {
        match &s.data {
            StmtData::SDirective(d) => out.push(d.value.slice()),
            _ => break,
        }
    }
    out
}

/// True if the leading directives of a top-level statement list contain a
/// `"use no memo"` / `"use no forget"`. Exposed so the parser can compute the
/// module-scope opt-out before constructing [`ReactCompilerState`].
pub fn has_module_scope_opt_out(stmts: &[Stmt]) -> bool {
    find_directive_disabling_memoization(&collect_body_directives(stmts)).is_some()
}

fn find_directive_enabling_memoization<'a>(directives: &[&'a [u8]]) -> Option<&'a [u8]> {
    directives
        .iter()
        .find(|d| OPT_IN_DIRECTIVES.contains(d))
        .copied()
}

fn find_directive_disabling_memoization<'a>(directives: &[&'a [u8]]) -> Option<&'a [u8]> {
    directives
        .iter()
        .find(|d| OPT_OUT_DIRECTIVES.contains(d))
        .copied()
}

/// Port of upstream `parseConfigPragmaForTests` (`Utils/TestUtils.ts`) for the
/// `@compilationMode` key only. Upstream's fixture corpus is generated with a
/// default of `"all"` and individual fixtures override via a leading
/// `// @compilationMode:"infer"` or `// @compilationMode(infer)` comment.
fn parse_compilation_mode_pragma(source: &[u8]) -> Option<String> {
    const KEY: &[u8] = b"@compilationMode";
    let mut i = bun_core::strings::index_of(source, KEY)?;
    i += KEY.len();
    let rest = source.get(i..)?;
    let (open, close) = match rest.first()? {
        b':' => (b'"', b'"'),
        b'(' => (b'(', b')'),
        _ => return None,
    };
    let start = rest.iter().position(|&c| c == open)? + 1;
    let len = rest.get(start..)?.iter().position(|&c| c == close)?;
    core::str::from_utf8(&rest[start..start + len])
        .ok()
        .map(str::to_owned)
}

// -----------------------------------------------------------------------
// Name helpers
// -----------------------------------------------------------------------

fn is_hook_name(s: &[u8]) -> bool {
    s.len() >= 4
        && s[0] == b'u'
        && s[1] == b's'
        && s[2] == b'e'
        && s.get(3)
            .is_some_and(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

fn is_component_name(name: &[u8]) -> bool {
    name.first().is_some_and(|c| c.is_ascii_uppercase())
}

/// For an `EImportIdentifier` ref, returns the original exported name from the
/// import clause (e.g. `useState` for `import {useState as _useState}`), falling
/// back to the local alias when no `namespace_alias` is recorded.
fn import_ref_name<'a>(host: &'a dyn Host, ref_: Ref) -> &'a [u8] {
    if ref_.is_symbol() {
        if let Some(sym) = host.symbols().get(ref_.inner_index() as usize) {
            if let Some(alias) = &sym.namespace_alias {
                return alias.alias.slice();
            }
        }
    }
    host.ref_name(ref_)
}

fn expr_is_hook(host: &dyn Host, expr: &Expr) -> bool {
    match &expr.data {
        ExprData::EIdentifier(id) => is_hook_name(host.ref_name(id.ref_)),
        ExprData::EImportIdentifier(id) => is_hook_name(import_ref_name(host, id.ref_)),
        ExprData::EDot(member) => {
            if !is_hook_name(member.name.slice()) {
                return false;
            }
            match &member.target.data {
                ExprData::EIdentifier(obj) => is_component_name(host.ref_name(obj.ref_)),
                ExprData::EImportIdentifier(obj) => is_component_name(host.ref_name(obj.ref_)),
                _ => false,
            }
        }
        _ => false,
    }
}

fn get_callee_name_if_react_api<'a>(host: &'a dyn Host, callee: &Expr) -> Option<&'a [u8]> {
    let name: &[u8] = match &callee.data {
        ExprData::EIdentifier(id) => host.ref_name(id.ref_),
        ExprData::EImportIdentifier(id) => host.ref_name(id.ref_),
        ExprData::EDot(member) => {
            let obj_name = match &member.target.data {
                ExprData::EIdentifier(obj) => host.ref_name(obj.ref_),
                ExprData::EImportIdentifier(obj) => host.ref_name(obj.ref_),
                _ => return None,
            };
            if obj_name != b"React" {
                return None;
            }
            member.name.slice()
        }
        _ => return None,
    };
    if name == b"forwardRef" || name == b"memo" {
        Some(name)
    } else {
        None
    }
}

// -----------------------------------------------------------------------
// AST traversal helpers
// -----------------------------------------------------------------------

fn is_non_node(expr: &Expr) -> bool {
    matches!(
        &expr.data,
        ExprData::EObject(_)
            | ExprData::EArrow(_)
            | ExprData::EFunction(_)
            | ExprData::EBigInt(_)
            | ExprData::EClass(_)
            | ExprData::ENew(_)
    )
}

fn returns_non_node_in_stmts(stmts: &[Stmt]) -> bool {
    let mut result = false;
    for stmt in stmts {
        returns_non_node_in_stmt(stmt, &mut result);
    }
    result
}

fn returns_non_node_in_stmt(stmt: &Stmt, result: &mut bool) {
    match &stmt.data {
        StmtData::SReturn(ret) => {
            *result = match &ret.value {
                Some(arg) => is_non_node(arg),
                None => true,
            };
        }
        StmtData::SBlock(block) => {
            for s in block.stmts.slice() {
                returns_non_node_in_stmt(s, result);
            }
        }
        StmtData::SIf(if_stmt) => {
            returns_non_node_in_stmt(&if_stmt.yes, result);
            if let Some(no) = &if_stmt.no {
                returns_non_node_in_stmt(no, result);
            }
        }
        StmtData::SFor(f) => returns_non_node_in_stmt(&f.body, result),
        StmtData::SWhile(w) => returns_non_node_in_stmt(&w.body, result),
        StmtData::SDoWhile(d) => returns_non_node_in_stmt(&d.body, result),
        StmtData::SForIn(f) => returns_non_node_in_stmt(&f.body, result),
        StmtData::SForOf(f) => returns_non_node_in_stmt(&f.body, result),
        StmtData::SSwitch(switch) => {
            for case in switch.cases.slice() {
                for s in case.body.slice() {
                    returns_non_node_in_stmt(s, result);
                }
            }
        }
        StmtData::STry(try_stmt) => {
            for s in try_stmt.body.slice() {
                returns_non_node_in_stmt(s, result);
            }
            if let Some(handler) = &try_stmt.catch_ {
                for s in handler.body.slice() {
                    returns_non_node_in_stmt(s, result);
                }
            }
            if let Some(finalizer) = &try_stmt.finally {
                for s in finalizer.stmts.slice() {
                    returns_non_node_in_stmt(s, result);
                }
            }
        }
        StmtData::SLabel(l) => returns_non_node_in_stmt(&l.stmt, result),
        StmtData::SWith(w) => returns_non_node_in_stmt(&w.body, result),
        StmtData::SFunction(_) | StmtData::SClass(_) => {}
        _ => {}
    }
}

fn calls_hooks_or_creates_jsx_in_stmts(host: &dyn Host, stmts: &[Stmt]) -> bool {
    stmts
        .iter()
        .any(|s| calls_hooks_or_creates_jsx_in_stmt(host, s))
}

fn calls_hooks_or_creates_jsx_in_stmt(host: &dyn Host, stmt: &Stmt) -> bool {
    match &stmt.data {
        StmtData::SExpr(e) => calls_hooks_or_creates_jsx_in_expr(host, &e.value),
        StmtData::SReturn(ret) => ret
            .value
            .as_ref()
            .is_some_and(|a| calls_hooks_or_creates_jsx_in_expr(host, a)),
        StmtData::SLocal(l) => l.decls.iter().any(|d| {
            d.value
                .as_ref()
                .is_some_and(|e| calls_hooks_or_creates_jsx_in_expr(host, e))
        }),
        StmtData::SBlock(b) => calls_hooks_or_creates_jsx_in_stmts(host, b.stmts.slice()),
        StmtData::SIf(i) => {
            calls_hooks_or_creates_jsx_in_expr(host, &i.test_)
                || calls_hooks_or_creates_jsx_in_stmt(host, &i.yes)
                || i.no
                    .as_ref()
                    .is_some_and(|n| calls_hooks_or_creates_jsx_in_stmt(host, n))
        }
        StmtData::SFor(f) => {
            f.init
                .as_ref()
                .is_some_and(|s| calls_hooks_or_creates_jsx_in_stmt(host, s))
                || f.test_
                    .as_ref()
                    .is_some_and(|e| calls_hooks_or_creates_jsx_in_expr(host, e))
                || f.update
                    .as_ref()
                    .is_some_and(|e| calls_hooks_or_creates_jsx_in_expr(host, e))
                || calls_hooks_or_creates_jsx_in_stmt(host, &f.body)
        }
        StmtData::SWhile(w) => {
            calls_hooks_or_creates_jsx_in_expr(host, &w.test_)
                || calls_hooks_or_creates_jsx_in_stmt(host, &w.body)
        }
        StmtData::SDoWhile(d) => {
            calls_hooks_or_creates_jsx_in_stmt(host, &d.body)
                || calls_hooks_or_creates_jsx_in_expr(host, &d.test_)
        }
        StmtData::SForIn(f) => {
            calls_hooks_or_creates_jsx_in_expr(host, &f.value)
                || calls_hooks_or_creates_jsx_in_stmt(host, &f.body)
        }
        StmtData::SForOf(f) => {
            calls_hooks_or_creates_jsx_in_expr(host, &f.value)
                || calls_hooks_or_creates_jsx_in_stmt(host, &f.body)
        }
        StmtData::SSwitch(s) => {
            if calls_hooks_or_creates_jsx_in_expr(host, &s.test_) {
                return true;
            }
            for case in s.cases.slice() {
                if case
                    .value
                    .as_ref()
                    .is_some_and(|e| calls_hooks_or_creates_jsx_in_expr(host, e))
                {
                    return true;
                }
                if calls_hooks_or_creates_jsx_in_stmts(host, case.body.slice()) {
                    return true;
                }
            }
            false
        }
        StmtData::SThrow(t) => calls_hooks_or_creates_jsx_in_expr(host, &t.value),
        StmtData::STry(t) => {
            calls_hooks_or_creates_jsx_in_stmts(host, t.body.slice())
                || t.catch_
                    .as_ref()
                    .is_some_and(|c| calls_hooks_or_creates_jsx_in_stmts(host, c.body.slice()))
                || t.finally
                    .as_ref()
                    .is_some_and(|f| calls_hooks_or_creates_jsx_in_stmts(host, f.stmts.slice()))
        }
        StmtData::SLabel(l) => calls_hooks_or_creates_jsx_in_stmt(host, &l.stmt),
        StmtData::SWith(w) => {
            calls_hooks_or_creates_jsx_in_expr(host, &w.value)
                || calls_hooks_or_creates_jsx_in_stmt(host, &w.body)
        }
        StmtData::SFunction(_) => false,
        StmtData::SClass(_) => false,
        _ => false,
    }
}

fn calls_hooks_or_creates_jsx_in_expr(host: &dyn Host, expr: &Expr) -> bool {
    match &expr.data {
        ExprData::EJsxElement(_) => true,
        ExprData::ECall(call) => {
            // Post-visit, JSX has been lowered to `E::Call{was_jsx_element}`.
            if call.was_jsx_element {
                return true;
            }
            if call.optional_chain.is_none() && expr_is_hook(host, &call.target) {
                return true;
            }
            if calls_hooks_or_creates_jsx_in_expr(host, &call.target) {
                return true;
            }
            call.args.iter().any(|a| {
                if matches!(&a.data, ExprData::EArrow(_) | ExprData::EFunction(_)) {
                    return false;
                }
                calls_hooks_or_creates_jsx_in_expr(host, a)
            })
        }
        ExprData::EBinary(b) => {
            calls_hooks_or_creates_jsx_in_expr(host, &b.left)
                || calls_hooks_or_creates_jsx_in_expr(host, &b.right)
        }
        ExprData::EIf(c) => {
            calls_hooks_or_creates_jsx_in_expr(host, &c.test_)
                || calls_hooks_or_creates_jsx_in_expr(host, &c.yes)
                || calls_hooks_or_creates_jsx_in_expr(host, &c.no)
        }
        ExprData::EUnary(u) => calls_hooks_or_creates_jsx_in_expr(host, &u.value),
        ExprData::EDot(m) => calls_hooks_or_creates_jsx_in_expr(host, &m.target),
        ExprData::EIndex(m) => {
            calls_hooks_or_creates_jsx_in_expr(host, &m.target)
                || calls_hooks_or_creates_jsx_in_expr(host, &m.index)
        }
        ExprData::ESpread(s) => calls_hooks_or_creates_jsx_in_expr(host, &s.value),
        ExprData::EAwait(a) => calls_hooks_or_creates_jsx_in_expr(host, &a.value),
        ExprData::EYield(y) => y
            .value
            .as_ref()
            .is_some_and(|v| calls_hooks_or_creates_jsx_in_expr(host, v)),
        ExprData::ETemplate(t) => {
            t.tag
                .as_ref()
                .is_some_and(|tag| calls_hooks_or_creates_jsx_in_expr(host, tag))
                || t.parts()
                    .iter()
                    .any(|p| calls_hooks_or_creates_jsx_in_expr(host, &p.value))
        }
        ExprData::EArray(arr) => arr
            .items
            .iter()
            .any(|e| calls_hooks_or_creates_jsx_in_expr(host, e)),
        ExprData::EObject(obj) => obj.properties.iter().any(|p| {
            p.value
                .as_ref()
                .is_some_and(|v| calls_hooks_or_creates_jsx_in_expr(host, v))
        }),
        ExprData::ENew(n) => {
            calls_hooks_or_creates_jsx_in_expr(host, &n.target)
                || n.args.iter().any(|a| {
                    if matches!(&a.data, ExprData::EArrow(_) | ExprData::EFunction(_)) {
                        return false;
                    }
                    calls_hooks_or_creates_jsx_in_expr(host, a)
                })
        }
        ExprData::EInlinedEnum(e) => calls_hooks_or_creates_jsx_in_expr(host, &e.value),
        ExprData::EArrow(_) | ExprData::EFunction(_) | ExprData::EClass(_) => false,
        _ => false,
    }
}

fn is_valid_component_params(host: &dyn Host, args: &[G::Arg], has_rest_arg: bool) -> bool {
    if args.is_empty() {
        return true;
    }
    if args.len() > 2 {
        return false;
    }
    if has_rest_arg && args.len() == 1 {
        return false;
    }
    if args.len() == 1 {
        return true;
    }
    if let b::B::BIdentifier(id) = &args[1].binding.data {
        let name = host.ref_name(id.r#ref);
        bun_core::strings::contains(name, b"ref") || bun_core::strings::contains(name, b"Ref")
    } else {
        false
    }
}

// -----------------------------------------------------------------------
// Function type detection
// -----------------------------------------------------------------------

fn get_react_function_type(
    host: &dyn Host,
    name: Option<&[u8]>,
    func: &FunctionNode<'_>,
    body_directives: &[&[u8]],
    parent_callee_name: Option<&[u8]>,
    opts: &ReactCompilerOptions,
) -> Option<ReactFunctionType> {
    if find_directive_enabling_memoization(body_directives).is_some() {
        return Some(
            get_component_or_hook_like(host, name, func, parent_callee_name)
                .unwrap_or(ReactFunctionType::Other),
        );
    }

    match opts.compilation_mode.as_deref().unwrap_or("infer") {
        "annotation" => None,
        "infer" => get_component_or_hook_like(host, name, func, parent_callee_name),
        "syntax" => None,
        "all" => Some(
            get_component_or_hook_like(host, name, func, parent_callee_name)
                .unwrap_or(ReactFunctionType::Other),
        ),
        _ => None,
    }
}

fn get_component_or_hook_like(
    host: &dyn Host,
    name: Option<&[u8]>,
    func: &FunctionNode<'_>,
    parent_callee_name: Option<&[u8]>,
) -> Option<ReactFunctionType> {
    let body = func.body().stmts.slice();
    if let Some(fn_name) = name {
        if is_component_name(fn_name) {
            let is_component = calls_hooks_or_creates_jsx_in_stmts(host, body)
                && is_valid_component_params(host, func.args(), func.has_rest_arg())
                && !returns_non_node_in_stmts(body);
            return if is_component {
                Some(ReactFunctionType::Component)
            } else {
                None
            };
        } else if is_hook_name(fn_name) {
            return if calls_hooks_or_creates_jsx_in_stmts(host, body) {
                Some(ReactFunctionType::Hook)
            } else {
                None
            };
        }
    }

    if let Some(callee_name) = parent_callee_name {
        if callee_name == b"forwardRef" || callee_name == b"memo" {
            return if calls_hooks_or_creates_jsx_in_stmts(host, body) {
                Some(ReactFunctionType::Component)
            } else {
                None
            };
        }
    }

    None
}

// -----------------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------------

fn handle_error(
    err: CompilerError,
    fn_name: Option<&str>,
    fn_loc: Loc,
    diagnostics: &mut Vec<CompileDiagnostic>,
    opts: &ReactCompilerOptions,
) -> Option<CompileOutput> {
    for detail in &err.details {
        let msg = match detail {
            CompilerErrorOrDiagnostic::Diagnostic(d) => d.reason.clone(),
            CompilerErrorOrDiagnostic::ErrorDetail(d) => d.reason.clone(),
        };
        diagnostics.push(CompileDiagnostic {
            fn_name: fn_name.map(str::to_owned),
            loc: fn_loc,
            message: msg,
        });
    }

    let should_panic = match opts.panic_threshold.as_deref().unwrap_or("none") {
        "all_errors" => true,
        "critical_errors" => err.has_errors(),
        _ => false,
    };

    let is_config_error = err.details.iter().any(|d| match d {
        CompilerErrorOrDiagnostic::Diagnostic(d) => d.category == ErrorCategory::Config,
        CompilerErrorOrDiagnostic::ErrorDetail(d) => d.category == ErrorCategory::Config,
    });

    if should_panic || is_config_error {
        Some(CompileOutput::Error {
            error: err,
            events: Vec::new(),
            ordered_log: Vec::new(),
        })
    } else {
        None
    }
}

// -----------------------------------------------------------------------
// AST application helpers
// -----------------------------------------------------------------------

fn leak_args(params: Vec<G::Arg>) -> StoreSlice<G::Arg> {
    let mut v: AstVec<G::Arg> = AstAlloc::vec_with_capacity(params.len());
    for p in params {
        v.push(p);
    }
    StoreSlice::new_mut(v.leak())
}

fn leak_stmts(body: Vec<Stmt>) -> StoreSlice<Stmt> {
    let mut v: AstVec<Stmt> = AstAlloc::vec_with_capacity(body.len());
    for s in body {
        v.push(s);
    }
    StoreSlice::new_mut(v.leak())
}

fn apply_to_gfn(target: &mut G::Fn, codegen_fn: CodegenFunction) {
    target.args = leak_args(codegen_fn.params);
    target.body = G::FnBody {
        loc: target.body.loc,
        stmts: leak_stmts(codegen_fn.body),
    };
    set_flag(&mut target.flags, flags::Function::IsAsync, codegen_fn.is_async);
    set_flag(
        &mut target.flags,
        flags::Function::IsGenerator,
        codegen_fn.generator,
    );
    set_flag(
        &mut target.flags,
        flags::Function::HasRestArg,
        codegen_fn.has_rest_arg,
    );
}

fn set_flag(flags: &mut flags::FunctionSet, flag: flags::Function, on: bool) {
    if on {
        flags.insert(flag);
    } else {
        flags.remove(flag);
    }
}

fn apply_to_arrow(target: &mut E::Arrow, codegen_fn: CodegenFunction) {
    target.args = leak_args(codegen_fn.params);
    target.body = G::FnBody {
        loc: target.body.loc,
        stmts: leak_stmts(codegen_fn.body),
    };
    target.is_async = codegen_fn.is_async;
    target.has_rest_arg = codegen_fn.has_rest_arg;
    target.prefer_expr = false;
}

fn build_outlined_decl(outlined: CodegenFunction) -> Stmt {
    let mut fn_flags = flags::FUNCTION_NONE;
    if outlined.is_async {
        fn_flags |= flags::Function::IsAsync;
    }
    if outlined.generator {
        fn_flags |= flags::Function::IsGenerator;
    }
    if outlined.has_rest_arg {
        fn_flags |= flags::Function::HasRestArg;
    }
    Stmt::alloc(
        S::Function {
            func: G::Fn {
                name: outlined.id,
                args: leak_args(outlined.params),
                body: G::FnBody {
                    loc: Loc::EMPTY,
                    stmts: leak_stmts(outlined.body),
                },
                flags: fn_flags,
                ..G::Fn::default()
            },
        },
        Loc::EMPTY,
    )
}

// -----------------------------------------------------------------------
// Per-file state — created before the visit pass, consulted per-function,
// finalized after.
// -----------------------------------------------------------------------

pub struct ReactCompilerState {
    options: ReactCompilerOptions,
    env_config: EnvironmentConfig,
    context: ProgramContext,
    diagnostics: Vec<CompileDiagnostic>,
    outlined_decls: Vec<Stmt>,
    /// `Some` once a fatal (panic-threshold or Config-category) error has been
    /// hit; subsequent `maybe_compile_*` calls become no-ops.
    fatal: Option<CompileOutput>,
    any_compiled: bool,
    /// `init_from_scope` / `validate_restricted_imports` ran.
    did_lazy_init: bool,
}

impl ReactCompilerState {
    /// Construct per-file state. Host-dependent initialization
    /// (`ProgramContext::init_from_scope`, restricted-import validation) is
    /// deferred to the first `maybe_compile_*` call so the parser can set
    /// `p.react_compiler = Some(..)` without a `&mut p` borrow conflict.
    pub fn new(options: ReactCompilerOptions, has_module_scope_opt_out: bool) -> Self {
        bun_core::scoped_log!(
            react_compiler,
            "ReactCompilerState::new opt_out={}",
            has_module_scope_opt_out
        );
        let context = ProgramContext::new(
            options.clone(),
            options.filename.clone(),
            None,
            has_module_scope_opt_out,
        );
        Self {
            env_config: options.environment.clone(),
            options,
            context,
            diagnostics: Vec::new(),
            outlined_decls: Vec::new(),
            fatal: None,
            any_compiled: false,
            did_lazy_init: false,
        }
    }

    pub fn any_compiled(&self) -> bool {
        self.any_compiled
    }

    fn lazy_init(&mut self, host: &dyn Host) {
        if self.did_lazy_init {
            return;
        }
        self.did_lazy_init = true;

        // A leading `// @compilationMode` pragma overrides the configured mode.
        // When neither the option nor the pragma is set, leave it `None` so
        // `get_react_function_type` falls through to the production default
        // (`"infer"`).
        if self.options.compilation_mode.is_none() {
            if let Some(mode) = parse_compilation_mode_pragma(host.source()) {
                self.options.compilation_mode = Some(mode.clone());
                self.context.opts.compilation_mode = Some(mode);
            }
        }

        self.context.init_from_scope(host.symbols());

        let restricted = self.options.environment.validate_blocklisted_imports.clone();
        if let Some(err) = validate_restricted_imports(host.import_records(), &restricted) {
            if let Some(fatal) =
                handle_error(err, None, Loc::EMPTY, &mut self.diagnostics, &self.options)
            {
                self.fatal = Some(fatal);
            }
        }
    }
}

// -----------------------------------------------------------------------
// Per-function entry points (called from `visit_stmt.rs` post-visit)
// -----------------------------------------------------------------------

/// Consider compiling a `function Foo() {}` declaration. On success the
/// `func` body/args are replaced in place. Returns `true` if compiled.
pub fn maybe_compile_function(
    state: &mut ReactCompilerState,
    host: &mut dyn Host,
    func: &mut G::Fn,
    name: Option<&[u8]>,
) -> bool {
    let loc = func.body.loc;
    let codegen_fn = {
        let node = FunctionNode::Function(&*func);
        match maybe_compile_node(state, host, node, name, None, loc) {
            Some(cf) => cf,
            None => return false,
        }
    };
    apply_to_gfn(func, codegen_fn);
    // The compiled body now calls `_c(N)` (the injected runtime import). Record
    // a use of the declaration's own name so the enclosing Part is not
    // tree-shaken away while the runtime-import Part — kept unconditionally as
    // a potentially side-effectful external import — survives, which would
    // otherwise leave a dangling `react/compiler-runtime` import in output.
    if let Some(name_ref) = func.name.as_ref().and_then(|n| n.ref_) {
        host.record_usage(name_ref);
    }
    true
}

/// Consider compiling a `const Foo = ...` initializer / `export default ...`
/// expression. Handles `EArrow`, `EFunction`, and `memo(...)` / `forwardRef(...)`
/// wrapping. On success the function body/args inside `expr` are replaced in
/// place. Returns `true` if compiled.
pub fn maybe_compile_expr(
    state: &mut ReactCompilerState,
    host: &mut dyn Host,
    expr: &mut Expr,
    name: Option<&[u8]>,
) -> bool {
    let loc = expr.loc;
    match &mut expr.data {
        ExprData::EArrow(a) => {
            let codegen_fn = {
                let node = FunctionNode::Arrow(&**a);
                match maybe_compile_node(state, host, node, name, None, loc) {
                    Some(cf) => cf,
                    None => return false,
                }
            };
            apply_to_arrow(a, codegen_fn);
            true
        }
        ExprData::EFunction(f) => {
            let inner_name_ref = f.func.name.as_ref().and_then(|n| n.ref_);
            let inner_name = inner_name_ref.map(|r| host.ref_name(r).to_vec());
            let codegen_fn = {
                let node = FunctionNode::Function(&f.func);
                match maybe_compile_node(
                    state,
                    host,
                    node,
                    inner_name.as_deref().or(name),
                    None,
                    loc,
                ) {
                    Some(cf) => cf,
                    None => return false,
                }
            };
            apply_to_gfn(&mut f.func, codegen_fn);
            if let Some(name_ref) = inner_name_ref {
                host.record_usage(name_ref);
            }
            true
        }
        ExprData::ECall(call) if !call.was_jsx_element => {
            let callee = match get_callee_name_if_react_api(&*host, &call.target) {
                Some(n) => n.to_vec(),
                None => return false,
            };
            let Some(arg) = call.args.first_mut() else {
                return false;
            };
            match &mut arg.data {
                ExprData::EArrow(a) => {
                    let codegen_fn = {
                        let node = FunctionNode::Arrow(&**a);
                        match maybe_compile_node(state, host, node, name, Some(&callee), loc) {
                            Some(cf) => cf,
                            None => return false,
                        }
                    };
                    apply_to_arrow(a, codegen_fn);
                    true
                }
                ExprData::EFunction(f) => {
                    let inner_name_ref = f.func.name.as_ref().and_then(|n| n.ref_);
                    let codegen_fn = {
                        let node = FunctionNode::Function(&f.func);
                        match maybe_compile_node(state, host, node, name, Some(&callee), loc) {
                            Some(cf) => cf,
                            None => return false,
                        }
                    };
                    apply_to_gfn(&mut f.func, codegen_fn);
                    if let Some(name_ref) = inner_name_ref {
                        host.record_usage(name_ref);
                    }
                    true
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn maybe_compile_node(
    state: &mut ReactCompilerState,
    host: &mut dyn Host,
    node: FunctionNode<'_>,
    name: Option<&[u8]>,
    parent_callee: Option<&[u8]>,
    fn_loc: Loc,
) -> Option<CodegenFunction> {
    bun_core::scoped_log!(
        react_compiler,
        "maybe_compile_node name={:?}",
        name.map(bun_core::BStr::new)
    );
    if state.fatal.is_some() {
        bun_core::scoped_log!(react_compiler, "  -> bail: prior fatal");
        return None;
    }
    state.lazy_init(&*host);
    if state.fatal.is_some() {
        bun_core::scoped_log!(react_compiler, "  -> bail: fatal after lazy_init");
        return None;
    }

    let body_directives = collect_body_directives(node.body().stmts.slice());
    let fn_type = get_react_function_type(
        &*host,
        name,
        &node,
        &body_directives,
        parent_callee,
        &state.options,
    );
    bun_core::scoped_log!(react_compiler, "  -> fn_type={:?}", fn_type);
    let fn_type = fn_type?;

    // Upstream still runs the full pipeline on opted-out functions to surface
    // validation diagnostics; Bun skips early — the diagnostics channel is not
    // wired yet, and skipping avoids registering a spurious runtime import.
    if find_directive_disabling_memoization(&body_directives).is_some()
        || state.context.has_module_scope_opt_out
    {
        bun_core::scoped_log!(react_compiler, "  -> bail: opt-out directive");
        return None;
    }

    let fn_name: Option<String> = name.and_then(|n| core::str::from_utf8(n).ok().map(str::to_owned));

    // SAFETY: the arena is owned by the `Host` implementor (the parser's `P`)
    // and outlives the `&mut dyn Host` borrow for the duration of this call.
    let arena: &bun_alloc::Arena =
        unsafe { &*std::ptr::from_ref::<bun_alloc::Arena>(host.arena()) };

    match pipeline::compile_fn(
        &node,
        fn_name.as_deref(),
        host,
        arena,
        fn_type,
        &state.env_config,
        &mut state.context,
    ) {
        Err(err) => {
            bun_core::scoped_log!(react_compiler, "  -> compile_fn err: {:?}", err);
            if let Some(fatal) = handle_error(
                err,
                fn_name.as_deref(),
                fn_loc,
                &mut state.diagnostics,
                &state.options,
            ) {
                state.fatal = Some(fatal);
            }
            None
        }
        Ok(mut codegen_fn) => {
            if state.context.opts.compilation_mode.as_deref() == Some("annotation")
                && find_directive_enabling_memoization(&body_directives).is_none()
            {
                return None;
            }
            for o in core::mem::take(&mut codegen_fn.outlined) {
                state.outlined_decls.push(build_outlined_decl(o.func));
            }
            state.any_compiled = true;
            Some(codegen_fn)
        }
    }
}

// -----------------------------------------------------------------------
// Finalization — emits the runtime import and any outlined fn decls.
// -----------------------------------------------------------------------

/// Consume the state after the visit pass. If any function was compiled,
/// `out_stmts` receives the `react/compiler-runtime` import statement
/// (prepended) plus any outlined function decls (appended). Returns the
/// summary `CompileOutput`.
pub fn finish(
    mut state: ReactCompilerState,
    host: &mut dyn Host,
    out_stmts: &mut Vec<Stmt>,
) -> CompileOutput {
    if let Some(fatal) = state.fatal.take() {
        return fatal;
    }

    if !state.any_compiled {
        return if state.diagnostics.is_empty() {
            CompileOutput::Unchanged
        } else {
            CompileOutput::Changed {
                diagnostics: state.diagnostics,
                events: Vec::new(),
                ordered_log: Vec::new(),
                renames: convert_renames(&state.context.renames),
            }
        };
    }

    out_stmts.append(&mut state.outlined_decls);
    add_imports_to_program(out_stmts, host, &state.context);

    CompileOutput::Changed {
        diagnostics: state.diagnostics,
        events: Vec::new(),
        ordered_log: Vec::new(),
        renames: convert_renames(&state.context.renames),
    }
}

fn convert_renames(
    renames: &[crate::hir::environment::BindingRename],
) -> Vec<crate::compile_result::BindingRenameInfo> {
    renames
        .iter()
        .map(|r| crate::compile_result::BindingRenameInfo {
            original: r.original.clone(),
            renamed: r.renamed.clone(),
            declaration_start: r.declaration_start,
        })
        .collect()
}
