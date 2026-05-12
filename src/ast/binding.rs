use bun_collections::VecExt;
#[cfg(debug_assertions)]
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;

use crate::StoreRef;
use crate::b::B;
use crate::base::Ref;
use crate::expr::{Data as ExprData, Expr};
use crate::{ExprNodeList, flags};
use crate::{e as E, g as G};

/// Zig: `Binding.Data` is the `union(Tag)` payload. In the Rust port that
/// union lives at `crate::b::B`; re-export it under the Zig-path name
/// so downstream crates can `use crate::binding::Data`.
pub use crate::b::B as Data;

// Zig file-as-struct: top-level fields `loc`, `data` define `Binding`.
#[derive(Copy, Clone, Default)]
pub struct Binding {
    pub loc: crate::Loc,
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
    pub fn json_stringify<W: crate::JsonWriter>(
        self,
        writer: &mut W,
    ) -> Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

// Zig: `pub var icount: usize = 0;` — mutable global counter, never read.
// Debug-only so release doesn't pay a contended `lock xadd` per Binding.
#[cfg(debug_assertions)]
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
impl BindingInit for StoreRef<crate::b::Identifier> {
    #[inline]
    fn into_b(self) -> B {
        B::BIdentifier(self)
    }
}
impl BindingInit for StoreRef<crate::b::Array> {
    #[inline]
    fn into_b(self) -> B {
        B::BArray(self)
    }
}
impl BindingInit for StoreRef<crate::b::Object> {
    #[inline]
    fn into_b(self) -> B {
        B::BObject(self)
    }
}
impl BindingInit for crate::b::Missing {
    #[inline]
    fn into_b(self) -> B {
        B::BMissing(self)
    }
}

pub trait BindingAlloc: Sized {
    fn alloc_into_b(self, bump: &Arena) -> B;
}
impl BindingAlloc for crate::b::Identifier {
    #[inline]
    fn alloc_into_b(self, bump: &Arena) -> B {
        B::BIdentifier(StoreRef::from_bump(bump.alloc(self)))
    }
}
impl BindingAlloc for crate::b::Array {
    #[inline]
    fn alloc_into_b(self, bump: &Arena) -> B {
        B::BArray(StoreRef::from_bump(bump.alloc(self)))
    }
}
impl BindingAlloc for crate::b::Object {
    #[inline]
    fn alloc_into_b(self, bump: &Arena) -> B {
        B::BObject(StoreRef::from_bump(bump.alloc(self)))
    }
}
impl BindingAlloc for crate::b::Missing {
    #[inline]
    fn alloc_into_b(self, _bump: &Arena) -> B {
        B::BMissing(crate::b::Missing {})
    }
}

impl Binding {
    #[inline]
    pub fn init(t: impl BindingInit, loc: crate::Loc) -> Binding {
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Binding {
            loc,
            data: t.into_b(),
        }
    }
    #[inline]
    pub fn alloc(bump: &Arena, t: impl BindingAlloc, loc: crate::Loc) -> Binding {
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Binding {
            loc,
            data: t.alloc_into_b(bump),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ToExpr — Zig: `fn ToExpr(comptime expr_type: type, comptime func_type: anytype) type`
// returns a struct holding `context: *ExprType` + `arena` whose
// `wrapIdentifier` calls the comptime `func_type`.
//
// Rust cannot store `*mut P<'a, const ..>` in a non-generic field nor take a
// fn item as a const generic, so the wrapper is type-erased: `wrap` is a plain
// fn pointer that casts the erased `ctx` back to the concrete `P` instantiation.
// Unlike Zig's struct, the `*ExprType` context is **not** stored — it is
// supplied at call time (`Binding::to_expr(.., ctx, ..)`) so the raw pointer's
// Stacked-Borrows tag is a child of the *live* `&mut P` at the call site rather
// than a stale tag captured during `prepare_for_visit_pass` (which every later
// `&mut self` retag would invalidate). The struct is `Copy` so the recursive
// `to_expr` can pass it by value like Zig's `wrapper: anytype`.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct ToExprWrapper {
    /// Back-reference to `P.arena`. `BackRef` invariant: the arena is owned by
    /// `P<'a>` and outlives every `ToExprWrapper` (which is stored on `P` and
    /// only used during the visit pass). `None` only for the pre-wire
    /// `dangling()` placeholder; niche-packed so layout matches `*const Arena`.
    arena: Option<bun_ptr::BackRef<Arena>>,
    wrap: fn(*mut core::ffi::c_void, crate::Loc, Ref) -> Expr,
}

impl ToExprWrapper {
    /// Placeholder used in `P::init` before `prepare_for_visit_pass` wires the
    /// arena + trampoline.
    pub const fn dangling() -> Self {
        Self {
            arena: None,
            wrap: |_, _, _| unreachable!("ToExprWrapper used before prepare_for_visit_pass"),
        }
    }

    /// Zig: `Context.init(context)` — captures `*ExprType` and its arena.
    /// `ExprType` is erased to `c_void`; callers (P.rs) supply a trampoline
    /// closure that casts back to `*mut P<..>` and dispatches to
    /// `P::wrap_identifier_{namespace,hoisting}`. Non-capturing closures
    /// coerce to fn pointers, so this stays zero-cost like Zig's comptime fn.
    /// The `*mut P` itself is passed per-call via `Binding::to_expr`.
    #[inline]
    pub fn new(arena: &Arena, wrap: fn(*mut core::ffi::c_void, crate::Loc, Ref) -> Expr) -> Self {
        Self {
            arena: Some(bun_ptr::BackRef::new(arena)),
            wrap,
        }
    }

    #[inline]
    pub fn wrap_identifier(&self, ctx: *mut core::ffi::c_void, loc: crate::Loc, ref_: Ref) -> Expr {
        (self.wrap)(ctx, loc, ref_)
    }

    #[inline]
    pub fn arena(&self) -> &Arena {
        // `BackRef::get` encapsulates the deref under the owner-outlives-holder
        // invariant; `expect` mirrors the prior `debug_assert!(!null)`.
        self.arena
            .as_ref()
            .expect("ToExprWrapper not wired (prepare_for_visit_pass)")
            .get()
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
    /// `ctx` is the type-erased `*mut P<..>` derived from the *caller's live*
    /// `&mut P` (e.g. `core::ptr::addr_of_mut!(*p) as *mut c_void`). Threading
    /// it per-call keeps the raw pointer's provenance under the active Unique
    /// borrow, avoiding the stale-tag UB of storing it long-term.
    ///
    /// Accepts the wrapper by `Borrow` so both the by-value call-site in
    /// `visitStmt.rs` (`p.to_expr_wrapper_namespace`) and the `&mut` call-site
    /// in `maybe.rs` (`&mut p.to_expr_wrapper_hoisted`) type-check without
    /// edits — `T: Borrow<T>` and `&mut T: Borrow<T>` are both blanket impls.
    pub fn to_expr<W>(binding: &Binding, ctx: *mut core::ffi::c_void, wrapper: W) -> Expr
    where
        W: core::borrow::Borrow<ToExprWrapper>,
    {
        Self::to_expr_inner(binding, ctx, *wrapper.borrow())
    }

    fn to_expr_inner(
        binding: &Binding,
        ctx: *mut core::ffi::c_void,
        wrapper: ToExprWrapper,
    ) -> Expr {
        let loc = binding.loc;
        match binding.data {
            B::BMissing(_) => Expr {
                data: ExprData::EMissing(E::Missing {}),
                loc,
            },
            B::BIdentifier(b) => wrapper.wrap_identifier(ctx, loc, b.r#ref),
            B::BArray(b) => {
                let b = b.get();
                let bump = wrapper.arena();
                let items = b.items();
                let len = items.len();
                let mut exprs = bun_alloc::ArenaVec::with_capacity_in(len, bump);
                let mut i: usize = 0;
                while i < len {
                    let item = &items[i];
                    let expr = Self::to_expr_inner(&item.binding, ctx, wrapper);
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
                        items: ExprNodeList::from_bump_vec(exprs),
                        is_single_line: b.is_single_line,
                        ..Default::default()
                    },
                    loc,
                )
            }
            B::BObject(b) => {
                let b = b.get();
                let bump = wrapper.arena();
                let props_in = b.properties();
                let mut properties = bun_alloc::ArenaVec::with_capacity_in(props_in.len(), bump);
                for item in props_in.iter() {
                    properties.push(G::Property {
                        flags: item.flags,
                        key: Some(item.key),
                        kind: if item.flags.contains(flags::Property::IsSpread) {
                            G::PropertyKind::Spread
                        } else {
                            G::PropertyKind::Normal
                        },
                        value: Some(Self::to_expr_inner(&item.value, ctx, wrapper)),
                        initializer: item.default_value,
                        ..Default::default()
                    });
                }
                Expr::init(
                    E::Object {
                        properties: G::PropertyList::from_bump_vec(properties),
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

// Fields are the JSON-serialization payload (Zig std.json wrote each via
// `@typeInfo` reflection). No `BindingJsonWriter` implementor exists yet, so
// rustc correctly proves they are never *read*; they are the data contract for
// when the writer lands, not dead code.
#[expect(dead_code)]
pub struct Serializable {
    r#type: Tag,
    object: &'static [u8],
    value: B,
    loc: crate::Loc,
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

// ported from: src/js_parser/ast/Binding.zig
