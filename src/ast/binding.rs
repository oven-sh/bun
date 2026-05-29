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

// Zig: `pub var icount: usize = 0;` — mutable global counter, never read.
// Debug-only so release doesn't pay a contended `lock xadd` per Binding.
#[cfg(debug_assertions)]
pub(crate) static ICOUNT: AtomicUsize = AtomicUsize::new(0);

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

#[derive(Copy, Clone)]
pub struct ToExprWrapper {
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

pub type ToExpr = ToExprWrapper;

impl Binding {
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

// ported from: src/js_parser/ast/Binding.zig
