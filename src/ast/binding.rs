use crate::b::B;
use crate::base::Ref;
use crate::expr::{Data as ExprData, Expr};
use crate::{AstArena, ExprNodeList, flags};
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
// `alloc` — a small trait implemented for each payload type picks the `B`
// variant; `Binding::alloc` stays monomorphic per call-site.
// ──────────────────────────────────────────────────────────────────────────

pub trait BindingAlloc: Sized {
    fn alloc_into_b(self, bump: &AstArena) -> B;
}
impl BindingAlloc for crate::b::Identifier {
    #[inline]
    fn alloc_into_b(self, bump: &AstArena) -> B {
        B::BIdentifier(bump.alloc_node(self))
    }
}
impl BindingAlloc for crate::b::Array {
    #[inline]
    fn alloc_into_b(self, bump: &AstArena) -> B {
        B::BArray(bump.alloc_node(self))
    }
}
impl BindingAlloc for crate::b::Object {
    #[inline]
    fn alloc_into_b(self, bump: &AstArena) -> B {
        B::BObject(bump.alloc_node(self))
    }
}
impl BindingAlloc for crate::b::Missing {
    #[inline]
    fn alloc_into_b(self, _bump: &AstArena) -> B {
        B::BMissing(crate::b::Missing {})
    }
}

impl Binding {
    #[inline]
    pub fn alloc(bump: &AstArena, t: impl BindingAlloc, loc: crate::Loc) -> Binding {
        Binding {
            loc,
            data: t.alloc_into_b(bump),
        }
    }

    pub fn to_expr<C>(
        binding: &Binding,
        bump: &AstArena,
        ctx: &mut C,
        wrap_identifier: impl Fn(&mut C, crate::Loc, Ref) -> Expr + Copy,
    ) -> Expr {
        let loc = binding.loc;
        match binding.data {
            B::BMissing(_) => Expr {
                data: ExprData::EMissing(E::Missing {}),
                loc,
            },
            B::BIdentifier(b) => wrap_identifier(ctx, loc, b.r#ref),
            B::BArray(b) => {
                let b = b.get();
                let items = b.items();
                let len = items.len();
                let mut exprs = bun_alloc::ArenaVec::with_capacity_in(len, bump);
                let mut i: usize = 0;
                while i < len {
                    let item = &items[i];
                    let expr = Self::to_expr(&item.binding, bump, ctx, wrap_identifier);
                    let converted = if b.has_spread && i == len - 1 {
                        Expr::allocate(bump, E::Spread { value: expr }, expr.loc)
                    } else if let Some(default) = item.default_value {
                        Expr::assign(bump, expr, default)
                    } else {
                        expr
                    };
                    exprs.push(converted);
                    i += 1;
                }
                Expr::allocate(
                    bump,
                    E::Array {
                        items: ExprNodeList::from_slice_in(&exprs, bump),
                        is_single_line: b.is_single_line,
                        ..Default::default()
                    },
                    loc,
                )
            }
            B::BObject(b) => {
                let b = b.get();
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
                        value: Some(Self::to_expr(&item.value, bump, ctx, wrap_identifier)),
                        initializer: item.default_value,
                        ..Default::default()
                    });
                }
                Expr::allocate(
                    bump,
                    E::Object {
                        properties: G::PropertyList::from_slice_in(&properties, bump),
                        is_single_line: b.is_single_line,
                        close_brace_loc: b.close_brace_loc,
                        ..Default::default()
                    },
                    loc,
                )
            }
        }
    }
}
