use bun_collections::{SmallList, VecExt};

use bun_alloc::{Arena, ArenaVec};

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
// `alloc` — a small trait implemented for each payload type picks the `B`
// variant; `Binding::alloc` stays monomorphic per call-site.
// ──────────────────────────────────────────────────────────────────────────

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
// `Copy` so a call site can take it out of `P` by value.
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
    pub(crate) fn wrap_identifier(
        &self,
        ctx: *mut core::ffi::c_void,
        loc: crate::Loc,
        ref_: Ref,
    ) -> Expr {
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

/// How many nested patterns a walk holds before its list of open patterns moves to the heap.
const INLINE_DEPTH: usize = 8;

/// An array or object pattern that [`Binding::to_expr`] is inside, with its children so far.
enum OpenPattern<'a> {
    Array {
        loc: crate::Loc,
        pattern: StoreRef<crate::b::Array>,
        items: ArenaVec<'a, Expr>,
    },
    Object {
        loc: crate::Loc,
        pattern: StoreRef<crate::b::Object>,
        properties: ArenaVec<'a, G::Property>,
    },
}

enum Entered<'a> {
    /// The expression of an identifier or a hole.
    Leaf(Expr),
    Pattern(OpenPattern<'a>),
}

impl<'a> OpenPattern<'a> {
    #[inline]
    fn enter(
        binding: &Binding,
        ctx: *mut core::ffi::c_void,
        wrapper: &'a ToExprWrapper,
    ) -> Entered<'a> {
        let loc = binding.loc;
        match binding.data {
            B::BMissing(_) => Entered::Leaf(Expr {
                data: ExprData::EMissing(E::Missing {}),
                loc,
            }),
            B::BIdentifier(b) => Entered::Leaf(wrapper.wrap_identifier(ctx, loc, b.r#ref)),
            B::BArray(pattern) => Entered::Pattern(OpenPattern::Array {
                loc,
                pattern,
                items: ArenaVec::with_capacity_in(pattern.items().len(), wrapper.arena()),
            }),
            B::BObject(pattern) => Entered::Pattern(OpenPattern::Object {
                loc,
                pattern,
                properties: ArenaVec::with_capacity_in(pattern.properties().len(), wrapper.arena()),
            }),
        }
    }

    /// The child to convert next, or `None` after the last one.
    fn next_child(&self) -> Option<Binding> {
        match self {
            OpenPattern::Array { pattern, items, .. } => {
                pattern.items().get(items.len()).map(|item| item.binding)
            }
            OpenPattern::Object {
                pattern,
                properties,
                ..
            } => pattern
                .properties()
                .get(properties.len())
                .map(|property| property.value),
        }
    }

    /// Takes the expression of the child that `next_child` returned.
    fn push(&mut self, child: Expr) {
        match self {
            OpenPattern::Array { pattern, items, .. } => {
                let index = items.len();
                let all = pattern.items();
                items.push(if pattern.has_spread && index == all.len() - 1 {
                    Expr::init(E::Spread { value: child }, child.loc)
                } else if let Some(default) = all[index].default_value {
                    Expr::assign(child, default)
                } else {
                    child
                });
            }
            OpenPattern::Object {
                pattern,
                properties,
                ..
            } => {
                let property = &pattern.properties()[properties.len()];
                properties.push(G::Property {
                    flags: property.flags,
                    key: Some(property.key),
                    kind: if property.flags.contains(flags::Property::IsSpread) {
                        G::PropertyKind::Spread
                    } else {
                        G::PropertyKind::Normal
                    },
                    value: Some(child),
                    initializer: property.default_value,
                    ..Default::default()
                });
            }
        }
    }

    /// The expression of the pattern, after its last child.
    fn close(self) -> Expr {
        match self {
            OpenPattern::Array {
                loc,
                pattern,
                items,
            } => Expr::init(
                E::Array {
                    items: ExprNodeList::from_bump_vec(items),
                    is_single_line: pattern.is_single_line,
                    ..Default::default()
                },
                loc,
            ),
            OpenPattern::Object {
                loc,
                pattern,
                properties,
            } => Expr::init(
                E::Object {
                    properties: G::PropertyList::from_bump_vec(properties),
                    is_single_line: pattern.is_single_line,
                    ..Default::default()
                },
                loc,
            ),
        }
    }

    /// Converts this pattern and all that nests in it. The patterns around the current one
    /// wait in `outer`, not on the native stack: a pattern nests as deep as the parser's
    /// stack check allowed, and this runs with the stack that the visit pass left.
    fn into_expr(self, ctx: *mut core::ffi::c_void, wrapper: &'a ToExprWrapper) -> Expr {
        let mut outer: SmallList<OpenPattern<'a>, INLINE_DEPTH> = SmallList::default();
        let mut current = self;
        loop {
            let expr = match current.next_child() {
                Some(child) => match Self::enter(&child, ctx, wrapper) {
                    Entered::Leaf(expr) => expr,
                    Entered::Pattern(pattern) => {
                        outer.append(core::mem::replace(&mut current, pattern));
                        continue;
                    }
                },
                None => {
                    let expr = current.close();
                    match outer.pop() {
                        Some(parent) => current = parent,
                        None => return expr,
                    }
                    expr
                }
            };
            current.push(expr);
        }
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
        Self::to_expr_with(binding, ctx, wrapper.borrow())
    }

    fn to_expr_with(
        binding: &Binding,
        ctx: *mut core::ffi::c_void,
        wrapper: &ToExprWrapper,
    ) -> Expr {
        match OpenPattern::enter(binding, ctx, wrapper) {
            Entered::Leaf(expr) => expr,
            Entered::Pattern(pattern) => pattern.into_expr(ctx, wrapper),
        }
    }

    /// The identifiers that this pattern binds, each with its location, depth first and
    /// left to right. Like [`Binding::to_expr`], the walk does not recurse into the pattern.
    #[inline]
    pub fn identifiers(&self) -> Identifiers {
        Identifiers {
            root: Some(*self),
            open: SmallList::default(),
        }
    }
}

/// See [`Binding::identifiers`].
pub struct Identifiers {
    /// The pattern itself, until the first call of `next`.
    root: Option<Binding>,
    /// The array and object patterns the walk is inside, outermost first, each with the
    /// index of its next child.
    open: SmallList<(B, u32), INLINE_DEPTH>,
}

impl Identifiers {
    /// The next child of the innermost open pattern that has one left.
    fn next_child(&mut self) -> Option<Binding> {
        loop {
            let (pattern, index) = self.open.last_mut()?;
            let child = match pattern {
                B::BArray(array) => array.items().get(*index as usize).map(|item| item.binding),
                B::BObject(object) => object
                    .properties()
                    .get(*index as usize)
                    .map(|property| property.value),
                B::BIdentifier(_) | B::BMissing(_) => None,
            };
            match child {
                Some(child) => {
                    *index += 1;
                    return Some(child);
                }
                None => {
                    self.open.pop();
                }
            }
        }
    }
}

impl Iterator for Identifiers {
    type Item = (crate::Loc, StoreRef<crate::b::Identifier>);

    // One copy for every walk that uses it: the callers are generic over the parser.
    #[inline(never)]
    fn next(&mut self) -> Option<Self::Item> {
        let mut binding = match self.root.take() {
            Some(root) => root,
            None => self.next_child()?,
        };
        loop {
            match binding.data {
                B::BIdentifier(identifier) => return Some((binding.loc, identifier)),
                B::BMissing(_) => {}
                B::BArray(_) | B::BObject(_) => self.open.append((binding.data, 0)),
            }
            binding = self.next_child()?;
        }
    }
}
