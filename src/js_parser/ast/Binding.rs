use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena; // bumpalo::Bump re-export (AST crate → arena allocation)
use bun_logger as logger;

use crate::ast::{B, E, Expr, ExprNodeList, G, Ref};

// Zig file-as-struct: top-level fields `loc`, `data` define `Binding`.
pub struct Binding {
    pub loc: logger::Loc,
    pub data: B,
}

struct Serializable {
    r#type: Tag,
    object: &'static [u8],
    value: B,
    loc: logger::Loc,
}

impl Binding {
    // TODO(port): Zig `jsonStringify` is the std.json protocol hook. Map to whatever
    // serialization protocol `bun_js_parser` adopts (likely a hand-rolled trait, not serde).
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: JsonWriter,
    {
        writer.write(&Serializable {
            r#type: self.data.active_tag(),
            object: b"binding",
            value: self.data,
            loc: self.loc,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ToExpr — Zig: `fn ToExpr(comptime expr_type: type, comptime func_type: anytype) type`
// Returns a struct whose `wrapIdentifier` calls the comptime `func_type`.
// Rust cannot take a fn as a const generic on stable, so the fn is stored as a
// field (ZST when monomorphized over a fn item). The duck-typed `wrapper` param
// of `to_expr` is expressed as the `ToExprWrapper` trait below.
// ──────────────────────────────────────────────────────────────────────────

/// Trait expressing the duck-typed `wrapper: anytype` parameter of `to_expr`.
/// Body calls `wrapper.wrapIdentifier(loc, ref)` and reads `wrapper.allocator`.
pub trait ToExprWrapper<'bump> {
    fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr;
    fn bump(&self) -> &'bump Arena;
}

pub struct ToExpr<'a, 'bump, ExprType> {
    // LIFETIMES.tsv: BORROW_PARAM → &'a mut ExprType
    pub context: &'a mut ExprType,
    // Zig: `allocator: std.mem.Allocator` — AST crate, arena-fed → &'bump Bump
    pub bump: &'bump Arena,
    // Zig: comptime `func_type` captured by the generated type.
    func: fn(&mut ExprType, logger::Loc, Ref) -> Expr,
}

impl<'a, 'bump, ExprType> ToExpr<'a, 'bump, ExprType> {
    pub fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr {
        // PORT NOTE: reshaped for borrowck — Zig took `*const Context` but passed
        // a mutable `*ExprType` through; Rust needs `&mut self` to reborrow `context`.
        (self.func)(self.context, loc, ref_)
    }

    // TODO(port): Zig `init` reads `context.allocator` (duck-typed). Callers must
    // now pass the arena explicitly alongside `func`. Phase B may introduce a
    // `HasArena` trait if many `ExprType`s share that field.
    pub fn init(
        context: &'a mut ExprType,
        bump: &'bump Arena,
        func: fn(&mut ExprType, logger::Loc, Ref) -> Expr,
    ) -> Self {
        Self { context, bump, func }
    }
}

impl<'a, 'bump, ExprType> ToExprWrapper<'bump> for ToExpr<'a, 'bump, ExprType> {
    fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr {
        ToExpr::wrap_identifier(self, loc, ref_)
    }
    fn bump(&self) -> &'bump Arena {
        self.bump
    }
}

// ──────────────────────────────────────────────────────────────────────────

impl Binding {
    pub fn to_expr<'bump>(binding: &Binding, wrapper: &mut impl ToExprWrapper<'bump>) -> Expr {
        let loc = binding.loc;

        match &binding.data {
            B::Missing(_) => {
                Expr { data: E::Missing(E::Missing {}).into(), loc }
            }
            B::Identifier(b) => {
                wrapper.wrap_identifier(loc, b.ref_)
            }
            B::Array(b) => {
                let bump = wrapper.bump();
                // PERF(port): Zig `allocator.alloc(Expr, n) catch unreachable` filled by index.
                // Using bump Vec + into_bump_slice to keep arena ownership.
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
            B::Object(b) => {
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
                        properties: G::PropertyList::from_owned_slice(properties.into_bump_slice()),
                        is_single_line: b.is_single_line,
                    },
                    loc,
                )
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

// Zig: `enum(u5)` — Rust has no u5; use u8 repr (values fit).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Tag {
    BIdentifier,
    BArray,
    BObject,
    BMissing,
}

impl Tag {
    // TODO(port): json serialization protocol — writes `@tagName(self)`.
    pub fn json_stringify<W: JsonWriter>(self, writer: &mut W) -> Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

// Zig: `pub var icount: usize = 0;` — mutable global counter.
// PERF(port): Zig used a plain non-atomic global; Rust requires atomic for safe
// shared mutation. Relaxed ordering matches the unsynchronized Zig increment.
pub static ICOUNT: AtomicUsize = AtomicUsize::new(0);

// ──────────────────────────────────────────────────────────────────────────
// `init` / `alloc` — Zig switches on `@TypeOf(t)` to pick the `B` variant.
// Rust expresses this dispatch via a trait implemented per payload type.
// ──────────────────────────────────────────────────────────────────────────

/// `Binding.init` dispatch: `t` is already an arena pointer (or `B.Missing` by value).
pub trait BindingInit<'bump> {
    fn into_b(self) -> B;
}

impl<'bump> BindingInit<'bump> for &'bump mut B::Identifier {
    fn into_b(self) -> B { B::Identifier(self) }
}
impl<'bump> BindingInit<'bump> for &'bump mut B::Array {
    fn into_b(self) -> B { B::Array(self) }
}
impl<'bump> BindingInit<'bump> for &'bump mut B::Object {
    fn into_b(self) -> B { B::Object(self) }
}
impl<'bump> BindingInit<'bump> for B::Missing {
    fn into_b(self) -> B { B::Missing(self) }
}

/// `Binding.alloc` dispatch: `t` is a value; allocate it in the arena.
pub trait BindingAlloc<'bump>: Sized {
    fn alloc_into_b(self, bump: &'bump Arena) -> B;
}

impl<'bump> BindingAlloc<'bump> for B::Identifier {
    fn alloc_into_b(self, bump: &'bump Arena) -> B {
        let data = bump.alloc(self);
        B::Identifier(data)
    }
}
impl<'bump> BindingAlloc<'bump> for B::Array {
    fn alloc_into_b(self, bump: &'bump Arena) -> B {
        let data = bump.alloc(self);
        B::Array(data)
    }
}
impl<'bump> BindingAlloc<'bump> for B::Object {
    fn alloc_into_b(self, bump: &'bump Arena) -> B {
        let data = bump.alloc(self);
        B::Object(data)
    }
}
impl<'bump> BindingAlloc<'bump> for B::Missing {
    fn alloc_into_b(self, _bump: &'bump Arena) -> B {
        B::Missing(B::Missing {})
    }
}

impl Binding {
    pub fn init<'bump>(t: impl BindingInit<'bump>, loc: logger::Loc) -> Binding {
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Binding { loc, data: t.into_b() }
    }

    pub fn alloc<'bump>(bump: &'bump Arena, t: impl BindingAlloc<'bump>, loc: logger::Loc) -> Binding {
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Binding { loc, data: t.alloc_into_b(bump) }
    }
}

// TODO(port): placeholder for the Zig `writer: anytype` json protocol used by
// `jsonStringify`. Phase B replaces with the real trait from `bun_js_parser`.
pub trait JsonWriter {
    fn write<T>(&mut self, value: T) -> Result<(), bun_core::Error>;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Binding.zig (171 lines)
//   confidence: medium
//   todos:      4
//   notes:      ToExpr comptime-fn param stored as fn ptr; @TypeOf dispatch → BindingInit/BindingAlloc traits; B/E/G variant paths are guesses pending sibling ports; Expr.Data.Store is typed_arena per §Allocators — `alloc()` here uses bumpalo, revisit if B nodes live in the typed Store.
// ──────────────────────────────────────────────────────────────────────────
