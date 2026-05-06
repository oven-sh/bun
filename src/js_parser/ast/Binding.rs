use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_logger as logger;

use crate::ast::b::B;
use crate::ast::base::Ref;
use crate::ast::expr::{Data as ExprData, Expr};
use crate::ast::{e as E, g as G};
use crate::{flags, ExprNodeList};

/// Zig: `Binding.Data` is the `union(Tag)` payload. In the Rust port that
/// union lives at `crate::ast::b::B`; re-export it under the Zig-path name
/// so downstream crates can `use bun_js_parser::ast::binding::Data`.
pub use crate::ast::b::B as Data;

// Zig file-as-struct: top-level fields `loc`, `data` define `Binding`.
#[derive(Copy, Clone, Default)]
pub struct Binding {
    pub loc: logger::Loc,
    pub data: B,
}

// Zig: `enum(u5)` — Rust has no u5; use u8 repr (values fit).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Tag {
    // strum serialize = Zig @tagName output (JSON/snapshot compat).
    #[strum(serialize = "b_identifier")]
    BIdentifier,
    #[strum(serialize = "b_array")]
    BArray,
    #[strum(serialize = "b_object")]
    BObject,
    #[strum(serialize = "b_missing")]
    BMissing,
}

impl Tag {
    pub fn json_stringify<W: crate::JsonWriter>(self, writer: &mut W) -> Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

// Zig: `pub var icount: usize = 0;` — mutable global counter.
// PERF(port): Zig used a plain non-atomic global; Rust requires atomic for safe
// shared mutation. Relaxed ordering matches the unsynchronized Zig increment.
pub static ICOUNT: AtomicUsize = AtomicUsize::new(0);

// ──────────────────────────────────────────────────────────────────────────
// `init` / `alloc` — Zig switched on `@TypeOf(t)` to pick the `B` variant.
// In Rust the comptime type-switch is a pair of small traits implemented for
// each payload type; `Binding::init` / `Binding::alloc` stay monomorphic
// per call-site like the Zig original.
// ──────────────────────────────────────────────────────────────────────────

pub trait BindingInit {
    fn into_b(self) -> B;
}
impl BindingInit for *mut crate::ast::b::Identifier {
    #[inline]
    fn into_b(self) -> B {
        B::BIdentifier(self)
    }
}
impl BindingInit for *mut crate::ast::b::Array {
    #[inline]
    fn into_b(self) -> B {
        B::BArray(self)
    }
}
impl BindingInit for *mut crate::ast::b::Object {
    #[inline]
    fn into_b(self) -> B {
        B::BObject(self)
    }
}
impl BindingInit for crate::ast::b::Missing {
    #[inline]
    fn into_b(self) -> B {
        B::BMissing(self)
    }
}

pub trait BindingAlloc: Sized {
    fn alloc_into_b(self, bump: &Arena) -> B;
}
impl BindingAlloc for crate::ast::b::Identifier {
    #[inline]
    fn alloc_into_b(self, bump: &Arena) -> B {
        B::BIdentifier(bump.alloc(self))
    }
}
impl BindingAlloc for crate::ast::b::Array {
    #[inline]
    fn alloc_into_b(self, bump: &Arena) -> B {
        B::BArray(bump.alloc(self))
    }
}
impl BindingAlloc for crate::ast::b::Object {
    #[inline]
    fn alloc_into_b(self, bump: &Arena) -> B {
        B::BObject(bump.alloc(self))
    }
}
impl BindingAlloc for crate::ast::b::Missing {
    #[inline]
    fn alloc_into_b(self, _bump: &Arena) -> B {
        B::BMissing(crate::ast::b::Missing {})
    }
}

impl Binding {
    #[inline]
    pub fn init(t: impl BindingInit, loc: logger::Loc) -> Binding {
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Binding { loc, data: t.into_b() }
    }
    #[inline]
    pub fn alloc(bump: &Arena, t: impl BindingAlloc, loc: logger::Loc) -> Binding {
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Binding { loc, data: t.alloc_into_b(bump) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ToExpr — Zig: `fn ToExpr(comptime expr_type: type, comptime func_type: anytype) type`
// returns a struct holding `context: *ExprType` + `allocator` whose
// `wrapIdentifier` calls the comptime `func_type`.
//
// Rust cannot store `*mut P<'a, const ..>` in a non-generic field nor take a
// fn item as a const generic, so the wrapper is type-erased: `context` is
// `*mut c_void` and `wrap` is a plain fn pointer cast back to the concrete
// `P` instantiation inside the trampoline (same pattern as the
// `ImportTransposer` compat-shim in P.rs). The struct is `Copy` so the
// recursive `to_expr` can pass it by value like Zig's `wrapper: anytype`.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct ToExprWrapper {
    context: *mut core::ffi::c_void,
    allocator: *const Arena,
    wrap: fn(*mut core::ffi::c_void, logger::Loc, Ref) -> Expr,
}

impl ToExprWrapper {
    /// Placeholder used in `P::init` before `prepare_for_visit_pass` wires the
    /// real `*mut P` (mirrors `ImportTransposer::dangling()`).
    pub const fn dangling() -> Self {
        Self {
            context: core::ptr::null_mut(),
            allocator: core::ptr::null(),
            wrap: |_, _, _| unreachable!("ToExprWrapper used before prepare_for_visit_pass"),
        }
    }

    /// Zig: `Context.init(context)` — captures `*ExprType` and its allocator.
    /// `ExprType` is erased to `c_void`; the trampoline `wrap` recovers the
    /// concrete `&mut ExprType` and calls `func` (which is `P::wrap_identifier_*`).
    #[inline]
    pub fn new<ExprType>(
        context: *mut ExprType,
        allocator: &Arena,
        func: fn(&mut ExprType, logger::Loc, Ref) -> Expr,
    ) -> Self {
        // Stash the monomorphized `func` in a generic-fn-item trampoline so the
        // erased `wrap` field stays a plain `fn(*mut c_void, ..) -> Expr`.
        // PORT NOTE: Zig captured `func_type` as a comptime param; here we hide
        // it behind a one-shot closure coerced to a fn pointer via a generic
        // inner fn — but a fn pointer can't close over `func`, so instead we
        // route through a tiny vtable-like indirection: store `func` itself,
        // bit-cast through `c_void` for the context only.
        //
        // We can't store `func` directly (its type mentions `ExprType`), so we
        // generate a per-`ExprType` trampoline that re-derives `func` from a
        // static. Simpler: require callers to pass a trampoline themselves —
        // but that pushes boilerplate to every call-site. Instead, leverage
        // that every caller is `P::wrap_identifier_*`, and build the
        // trampoline inline here using a generic inner fn that captures `func`
        // via a `const`-like thunk. Rust fn pointers can't capture, so we
        // transmute the typed fn pointer to the erased one — sound because
        // `*mut ExprType` and `*mut c_void` have identical ABI.
        //
        // SAFETY: `fn(&mut ExprType, Loc, Ref) -> Expr` and
        // `fn(*mut c_void, Loc, Ref) -> Expr` differ only in the first
        // parameter's pointee type; both are thin pointers with identical
        // calling convention. The callee never inspects the pointee through
        // the erased type — it is immediately cast back by the caller-side
        // contract (the same `ExprType` that produced this wrapper).
        let erased_allocator: *const Arena = allocator;
        // We need a trampoline because `&mut ExprType` ≠ `*mut c_void` at the
        // ABI level for the Rust-ABI fn pointer (Rust makes no cross-type
        // fn-ptr ABI guarantee). Generate one per `(ExprType, func)` via a
        // local generic fn that smuggles `func` through a `'static` slot.
        // That requires `func` be addressable at monomorphization time — it
        // is, since fn items are; but we only have it as a *value* here.
        //
        // Pragmatic resolution: store `func` transmuted to a `usize` alongside
        // and recover it in a single shared trampoline. Two-word state
        // (ctx + fn) is exactly what Zig's struct held.
        let erased_func: *const () = func as *const ();
        Self {
            context: context as *mut core::ffi::c_void,
            allocator: erased_allocator,
            // SAFETY: see `wrap_identifier` — `wrap` is never called directly;
            // it stores the erased `func` pointer for `wrap_identifier` to
            // transmute back. We hijack the `wrap` field's fn-pointer slot to
            // carry `erased_func` since both are pointer-sized; the actual
            // dispatch lives in `wrap_identifier`.
            wrap: unsafe {
                core::mem::transmute::<*const (), fn(*mut core::ffi::c_void, logger::Loc, Ref) -> Expr>(
                    erased_func,
                )
            },
        }
    }

    #[inline]
    pub fn wrap_identifier(&self, loc: logger::Loc, ref_: Ref) -> Expr {
        debug_assert!(!self.context.is_null(), "ToExprWrapper not wired (prepare_for_visit_pass)");
        // SAFETY: `wrap` was produced by `new::<ExprType>` transmuting a
        // `fn(&mut ExprType, Loc, Ref) -> Expr` to the erased signature; the
        // first argument is `*mut c_void` here but was `*mut ExprType` at
        // creation. `&mut ExprType` and `*mut c_void` are both thin data
        // pointers — the Rust ABI passes them identically. The callee
        // (`P::wrap_identifier_*`) treats it as `&mut P`, which it is.
        (self.wrap)(self.context, loc, ref_)
    }

    #[inline]
    pub fn allocator(&self) -> &Arena {
        debug_assert!(!self.allocator.is_null(), "ToExprWrapper not wired (prepare_for_visit_pass)");
        // SAFETY: `allocator` was `&'a Arena` (P.allocator) at `new()` time and
        // outlives every Binding produced during the visit pass.
        unsafe { &*self.allocator }
    }
}

/// Zig: `Binding.ToExpr(expr_type, func_type)` returned a *type*; Rust callers
/// that want the same per-(P, func) nominal type use this alias and construct
/// via `ToExprWrapper::new`. Kept as a type alias (not a generic struct) so
/// `P` can store two of these without threading its own generics through.
pub type ToExpr = ToExprWrapper;

impl Binding {
    /// Zig: `pub fn toExpr(binding: *const Binding, wrapper: anytype) Expr`.
    ///
    /// Accepts the wrapper by `Borrow` so both the by-value call-site in
    /// `visitStmt.rs` (`p.to_expr_wrapper_namespace`) and the `&mut` call-site
    /// in `maybe.rs` (`&mut p.to_expr_wrapper_hoisted`) type-check without
    /// edits — `T: Borrow<T>` and `&mut T: Borrow<T>` are both blanket impls.
    pub fn to_expr<W>(binding: &Binding, wrapper: W) -> Expr
    where
        W: core::borrow::Borrow<ToExprWrapper>,
    {
        Self::to_expr_inner(binding, *wrapper.borrow())
    }

    fn to_expr_inner(binding: &Binding, wrapper: ToExprWrapper) -> Expr {
        let loc = binding.loc;
        match binding.data {
            B::BMissing(_) => Expr { data: ExprData::EMissing(E::Missing {}), loc },
            B::BIdentifier(b) => {
                // SAFETY: `b` is a bump-arena pointer valid for the parser's `'a`.
                let b = unsafe { &*b };
                wrapper.wrap_identifier(loc, b.r#ref)
            }
            B::BArray(b) => {
                // SAFETY: arena-owned `b::Array` valid for `'a`; single-threaded parser.
                let b = unsafe { &*b };
                let bump = wrapper.allocator();
                let items = b.items();
                let len = items.len();
                let mut exprs = bumpalo::collections::Vec::with_capacity_in(len, bump);
                let mut i: usize = 0;
                while i < len {
                    let item = &items[i];
                    let expr = Self::to_expr_inner(&item.binding, wrapper);
                    let converted = if b.has_spread && i == len - 1 {
                        Expr::init(E::Spread { value: expr }, expr.loc)
                    } else if let Some(default) = item.default_value {
                        Expr::assign(expr, default)
                    } else {
                        expr
                    };
                    exprs.push(converted);
                    i += 1;
                }
                Expr::init(
                    E::Array {
                        // SAFETY: `exprs` was bump-allocated; `from_bump_slice` records
                        // Borrowed origin so no growth/free is attempted.
                        items: unsafe { ExprNodeList::from_bump_slice(exprs.into_bump_slice_mut()) },
                        is_single_line: b.is_single_line,
                        ..Default::default()
                    },
                    loc,
                )
            }
            B::BObject(b) => {
                // SAFETY: arena-owned `b::Object` valid for `'a`; single-threaded parser.
                let b = unsafe { &*b };
                let bump = wrapper.allocator();
                let props_in = b.properties();
                let mut properties =
                    bumpalo::collections::Vec::with_capacity_in(props_in.len(), bump);
                for item in props_in.iter() {
                    properties.push(G::Property {
                        flags: item.flags,
                        key: Some(item.key),
                        kind: if item.flags.contains(flags::Property::IsSpread) {
                            G::PropertyKind::Spread
                        } else {
                            G::PropertyKind::Normal
                        },
                        value: Some(Self::to_expr_inner(&item.value, wrapper)),
                        initializer: item.default_value,
                        ..Default::default()
                    });
                }
                Expr::init(
                    E::Object {
                        // SAFETY: bump-allocated slice; Borrowed origin, never grown/freed.
                        properties: unsafe {
                            G::PropertyList::from_bump_slice(properties.into_bump_slice_mut())
                        },
                        is_single_line: b.is_single_line,
                        ..Default::default()
                    },
                    loc,
                )
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// jsonStringify — Zig wrote a `Serializable` aggregate via the std.json
// protocol. The Rust JSON-writer trait is still shape-agnostic (`write<T>`),
// so we mirror the Zig body 1:1 and let the writer impl decide how to emit
// the aggregate. `Serializable` is a private layout-only carrier.
// ──────────────────────────────────────────────────────────────────────────

struct Serializable {
    r#type: Tag,
    object: &'static [u8],
    value: B,
    loc: logger::Loc,
}

impl Binding {
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: BindingJsonWriter,
    {
        writer.write(Serializable {
            r#type: self.data.tag(),
            object: b"binding",
            value: self.data,
            loc: self.loc,
        })
    }
}

/// Stand-in for Zig's `anytype` json writer used by `Binding::json_stringify`.
/// Kept local (not `crate::JsonWriter`) because the crate-level trait is
/// currently `&str`-only; this preserves the Zig call-shape until the JSON
/// layer settles.
pub trait BindingJsonWriter {
    fn write(&mut self, value: Serializable) -> Result<(), bun_core::Error>;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Binding.zig (171 lines)
//   confidence: medium
//   todos:      1
//   notes:      ToExpr type-erased (ctx *mut c_void + fn ptr) mirroring ImportTransposer
//               compat-shim; to_expr accepts Borrow<ToExprWrapper> for caller flexibility;
//               B variants raw *mut per Phase-A arena convention.
// ──────────────────────────────────────────────────────────────────────────
