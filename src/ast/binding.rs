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

// Debug-only so release doesn't pay a contended `lock xadd` per Binding.
#[cfg(debug_assertions)]
pub(crate) static ICOUNT: AtomicUsize = AtomicUsize::new(0);

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

impl Binding {
    /// Convert a binding pattern into the equivalent assignment-target `Expr`.
    /// `wrap_identifier` supplies the caller's policy for each identifier in
    /// the pattern (e.g. hoist a declaration and return the identifier
    /// expression); produced nodes are allocated from `arena`.
    /// (The parser has its own re-entrant variant: `P::binding_to_expr`.)
    pub fn to_expr(
        binding: &Binding,
        arena: &Arena,
        wrap_identifier: &mut dyn FnMut(crate::Loc, Ref) -> Expr,
    ) -> Expr {
        let loc = binding.loc;
        match binding.data {
            B::BMissing(_) => Expr {
                data: ExprData::EMissing(E::Missing {}),
                loc,
            },
            B::BIdentifier(b) => wrap_identifier(loc, b.r#ref),
            B::BArray(b) => {
                let b = b.get();
                let items = b.items();
                let len = items.len();
                let mut exprs = bun_alloc::ArenaVec::with_capacity_in(len, arena);
                let mut i: usize = 0;
                while i < len {
                    let item = &items[i];
                    let expr = Self::to_expr(&item.binding, arena, wrap_identifier);
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
                let props_in = b.properties();
                let mut properties = bun_alloc::ArenaVec::with_capacity_in(props_in.len(), arena);
                for item in props_in.iter() {
                    properties.push(G::Property {
                        flags: item.flags,
                        key: Some(item.key),
                        kind: if item.flags.contains(flags::Property::IsSpread) {
                            G::PropertyKind::Spread
                        } else {
                            G::PropertyKind::Normal
                        },
                        value: Some(Self::to_expr(&item.value, arena, wrap_identifier)),
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
