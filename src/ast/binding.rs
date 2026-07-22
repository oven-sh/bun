use bun_collections::VecExt;

use bun_alloc::Arena;

use crate::StoreRef;
use crate::b::B;
use crate::base::Ref;
use crate::expr::{Data as ExprData, Expr};
use crate::{ExprNodeList, flags};
use crate::{e as E, g as G};

/// `Binding`'s payload union lives at `crate::b::B`; re-export it as `Data`
/// so downstream crates can `use crate::binding::Data`.
pub use crate::b::B as Data;

#[derive(Copy, Clone, Default)]
pub struct Binding {
    pub loc: crate::Loc,
    pub data: B,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Tag {
    // strum serialize = snake_case tag names (JSON/snapshot compat).
    #[strum(serialize = "b_identifier")]
    BIdentifier,
    #[strum(serialize = "b_array")]
    BArray,
    #[strum(serialize = "b_object")]
    BObject,
    #[strum(serialize = "b_missing")]
    BMissing,
}

// ──────────────────────────────────────────────────────────────────────────
// `init` / `alloc` — a pair of small traits implemented for each payload
// type pick the `B` variant; `Binding::init` / `Binding::alloc` stay
// monomorphic per call-site.
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
        Binding {
            loc,
            data: t.into_b(),
        }
    }
    #[inline]
    pub fn alloc(bump: &Arena, t: impl BindingAlloc, loc: crate::Loc) -> Binding {
        Binding {
            loc,
            data: t.alloc_into_b(bump),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ToExpr — Rust cannot store `*mut P<'a, const ..>` in a non-generic field
// nor take a fn item as a const generic, so the wrapper is type-erased:
// `wrap` is a plain fn pointer that casts the erased `ctx` back to the
// concrete `P` instantiation. The `*ExprType` context is **not** stored — it
// is supplied at call time (`Binding::to_expr(.., ctx, ..)`) so the raw
// pointer's Stacked-Borrows tag is a child of the *live* `&mut P` at the call
// site rather than a stale tag captured during `prepare_for_visit_pass`
// (which every later `&mut self` retag would invalidate). The struct is
// `Copy` so the recursive `to_expr` can pass it by value.
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

    /// `ExprType` is erased to `c_void`; callers (P.rs) supply a trampoline
    /// closure that casts back to `*mut P<..>` and dispatches to
    /// `P::wrap_identifier_{namespace,hoisting}`. Non-capturing closures
    /// coerce to fn pointers, so this stays zero-cost.
    /// The `*mut P` itself is passed per-call via `Binding::to_expr`.
    #[inline]
    pub fn new(arena: &Arena, wrap: fn(*mut core::ffi::c_void, crate::Loc, Ref) -> Expr) -> Self {
        Self {
            arena: Some(bun_ptr::BackRef::new(arena)),
            wrap,
        }
    }

    #[inline]
    pub(crate) fn wrap_identifier(&self, ctx: *mut core::ffi::c_void, loc: crate::Loc, ref_: Ref) -> Expr {
        (self.wrap)(ctx, loc, ref_)
    }

    #[inline]
    pub(crate) fn arena(&self) -> &Arena {
        // `BackRef::get` encapsulates the deref under the owner-outlives-holder
        // invariant; `expect` mirrors the prior `debug_assert!(!null)`.
        self.arena
            .as_ref()
            .expect("ToExprWrapper not wired (prepare_for_visit_pass)")
            .get()
    }
}

impl Binding {
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
