use core::sync::atomic::{AtomicUsize, Ordering};

use bun_logger as logger;

use crate::ast::b::B;

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
// TODO(b2-ast-round): the rest of Binding.zig (ToExpr / to_expr / json_stringify
// / BindingInit / BindingAlloc / init / alloc) depends on `E::*` payloads,
// `Expr::{init,assign}`, `G::Property` field set, and arena lifetimes. The
// Phase-A draft body is preserved below for the next round.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(any())]
mod _draft {
    use super::*;
    use bun_alloc::Arena;
    use crate::ast::base::Ref;
    use crate::ast::expr::Expr;
    use crate::ast::{e as E, g as G};
    use crate::ExprNodeList;

    struct Serializable {
        r#type: Tag,
        object: &'static [u8],
        value: B,
        loc: logger::Loc,
    }

    impl Binding {
        // TODO(port): Zig `jsonStringify` is the std.json protocol hook.
        pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
        where
            W: JsonWriter,
        {
            writer.write(&Serializable {
                r#type: self.data.tag(),
                object: b"binding",
                value: self.data,
                loc: self.loc,
            })
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // ToExpr — Zig: `fn ToExpr(comptime expr_type: type, comptime func_type: anytype) type`
    // Returns a struct whose `wrapIdentifier` calls the comptime `func_type`.
    // Rust cannot take a fn as a const generic, so `func_type` becomes a generic
    // `F: Fn(...)` field — when callers pass a fn item, `F` is a ZST and the call
    // monomorphizes (matching Zig's zero-cost comptime dispatch).
    // ──────────────────────────────────────────────────────────────────────

    pub trait ToExprWrapper<'bump> {
        fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr;
        fn bump(&self) -> &'bump Arena;
    }

    pub struct ToExpr<'a, 'bump, ExprType, F>
    where
        F: Fn(&mut ExprType, logger::Loc, Ref) -> Expr,
    {
        pub context: &'a mut ExprType,
        pub bump: &'bump Arena,
        func: F,
    }

    impl<'a, 'bump, ExprType, F> ToExpr<'a, 'bump, ExprType, F>
    where
        F: Fn(&mut ExprType, logger::Loc, Ref) -> Expr,
    {
        pub fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr {
            (self.func)(self.context, loc, ref_)
        }
        pub fn init(context: &'a mut ExprType, bump: &'bump Arena, func: F) -> Self {
            Self { context, bump, func }
        }
    }

    impl<'a, 'bump, ExprType, F> ToExprWrapper<'bump> for ToExpr<'a, 'bump, ExprType, F>
    where
        F: Fn(&mut ExprType, logger::Loc, Ref) -> Expr,
    {
        fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr {
            ToExpr::wrap_identifier(self, loc, ref_)
        }
        fn bump(&self) -> &'bump Arena {
            self.bump
        }
    }

    impl Binding {
        pub fn to_expr<'bump>(binding: &Binding, wrapper: &mut impl ToExprWrapper<'bump>) -> Expr {
            let loc = binding.loc;
            match &binding.data {
                B::BMissing(_) => Expr { data: E::Missing(E::Missing {}).into(), loc },
                B::BIdentifier(b) => wrapper.wrap_identifier(loc, b.ref_),
                B::BArray(b) => {
                    let bump = wrapper.bump();
                    let mut exprs =
                        bumpalo::collections::Vec::with_capacity_in(b.items.len(), bump);
                    let len = b.items.len();
                    let mut i: usize = 0;
                    while i < len {
                        let item = &b.items[i];
                        let converted = 'convert: {
                            let expr = Binding::to_expr(&item.binding, wrapper);
                            if b.has_spread && i == len - 1 {
                                break 'convert Expr::init(E::Spread { value: expr }, expr.loc);
                            } else if let Some(default) = item.default_value {
                                break 'convert Expr::assign(expr, default);
                            } else {
                                break 'convert expr;
                            }
                        };
                        exprs.push(converted);
                        i += 1;
                    }
                    Expr::init(
                        E::Array {
                            items: ExprNodeList::from_owned_slice(exprs.into_bump_slice()),
                            is_single_line: b.is_single_line,
                        },
                        loc,
                    )
                }
                B::BObject(b) => {
                    let bump = wrapper.bump();
                    let mut properties =
                        bumpalo::collections::Vec::with_capacity_in(b.properties.len(), bump);
                    debug_assert_eq!(properties.capacity(), b.properties.len());
                    for item in b.properties.iter() {
                        properties.push(G::Property {
                            flags: item.flags,
                            key: item.key,
                            kind: if item.flags.contains(G::PropertyFlag::IsSpread) {
                                G::PropertyKind::Spread
                            } else {
                                G::PropertyKind::Normal
                            },
                            value: Binding::to_expr(&item.value, wrapper),
                            initializer: item.default_value,
                        });
                    }
                    Expr::init(
                        E::Object {
                            properties: G::PropertyList::from_owned_slice(
                                properties.into_bump_slice(),
                            ),
                            is_single_line: b.is_single_line,
                        },
                        loc,
                    )
                }
            }
        }
    }

    // `init` / `alloc` — Zig switches on `@TypeOf(t)` to pick the `B` variant.
    pub trait BindingInit {
        fn into_b(self) -> B;
    }
    impl BindingInit for *mut crate::ast::b::Identifier {
        fn into_b(self) -> B {
            B::BIdentifier(self)
        }
    }
    impl BindingInit for *mut crate::ast::b::Array {
        fn into_b(self) -> B {
            B::BArray(self)
        }
    }
    impl BindingInit for *mut crate::ast::b::Object {
        fn into_b(self) -> B {
            B::BObject(self)
        }
    }
    impl BindingInit for crate::ast::b::Missing {
        fn into_b(self) -> B {
            B::BMissing(self)
        }
    }

    pub trait BindingAlloc: Sized {
        fn alloc_into_b(self, bump: &Arena) -> B;
    }
    impl BindingAlloc for crate::ast::b::Identifier {
        fn alloc_into_b(self, bump: &Arena) -> B {
            B::BIdentifier(bump.alloc(self))
        }
    }
    impl BindingAlloc for crate::ast::b::Array {
        fn alloc_into_b(self, bump: &Arena) -> B {
            B::BArray(bump.alloc(self))
        }
    }
    impl BindingAlloc for crate::ast::b::Object {
        fn alloc_into_b(self, bump: &Arena) -> B {
            B::BObject(bump.alloc(self))
        }
    }
    impl BindingAlloc for crate::ast::b::Missing {
        fn alloc_into_b(self, _bump: &Arena) -> B {
            B::BMissing(crate::ast::b::Missing {})
        }
    }

    impl Binding {
        pub fn init(t: impl BindingInit, loc: logger::Loc) -> Binding {
            ICOUNT.fetch_add(1, Ordering::Relaxed);
            Binding { loc, data: t.into_b() }
        }
        pub fn alloc(bump: &Arena, t: impl BindingAlloc, loc: logger::Loc) -> Binding {
            ICOUNT.fetch_add(1, Ordering::Relaxed);
            Binding { loc, data: t.alloc_into_b(bump) }
        }
    }

    pub trait JsonWriter {
        fn write<T>(&mut self, value: T) -> Result<(), bun_core::Error>;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Binding.zig (171 lines)
//   confidence: medium
//   todos:      4
//   notes:      ToExpr/to_expr/init/alloc preserved under cfg(any()) until E/Expr land; B variants raw *mut per Phase-A arena convention.
// ──────────────────────────────────────────────────────────────────────────
