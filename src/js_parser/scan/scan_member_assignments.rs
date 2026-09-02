//! A top-level `X.y = v` on a local, never reassigned class, function, or
//! object literal is observable only through `X`: its part becomes removable
//! and a declaring part of `X`, so it lives exactly when `X` does.

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::ast_result::TopLevelSymbolToParts;
use bun_ast::g::PropertyKind;
use bun_ast::{
    self as js_ast, E, Expr, ExprData, Flags, G, Ref, S, Stmt, StmtData, StmtOrExpr, StoreRef,
};
use bun_collections::{HashMap, VecExt as _};

use crate::p::P;

/// One `X.a.b = v` part.
#[derive(Clone, Copy)]
pub(crate) struct Candidate<'a> {
    part_index: u32,
    owner: Ref,
    /// Outermost first: `[a, b]`.
    keys: &'a [&'a [u8]],
    /// `v` is a literal, function, or class, so it aliases nothing outside `X`.
    value_is_fresh: bool,
}

#[derive(Clone, Copy)]
enum ClassSource {
    Stmt(StoreRef<S::Class>),
    Expr(StoreRef<G::Class>),
}

impl ClassSource {
    fn class(&self) -> &G::Class {
        match self {
            Self::Stmt(stmt) => &stmt.class,
            Self::Expr(class) => class,
        }
    }
}

#[derive(Clone, Copy)]
enum OwnerShape {
    Class(ClassSource),
    Function {
        is_arrow: bool,
    },
    /// The `EObject` initializer.
    Object(Expr),
}

/// `None` caches "does not qualify".
type ShapeCache = HashMap<Ref, Option<OwnerShape>>;

const MAX_EXTENDS_DEPTH: usize = 32;

fn key_bytes<'b>(s: &E::EString, arena: &'b Bump) -> &'b [u8] {
    bun_core::handle_oom(s.flattened(arena).string(arena))
}

fn is_proper_prefix(short: &[&[u8]], long: &[&[u8]]) -> bool {
    short.len() < long.len() && short.iter().zip(long).all(|(a, b)| a == b)
}

fn value_is_fresh(value: &Expr) -> bool {
    value.is_primitive_literal()
        || matches!(
            value.data,
            ExprData::EObject(_)
                | ExprData::EArray(_)
                | ExprData::EFunction(_)
                | ExprData::EArrow(_)
                | ExprData::EClass(_)
                | ExprData::ERegExp(_)
        )
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// The member assignment that alone keeps `part` from being removable.
    pub(crate) fn member_assignment_candidate(
        &mut self,
        part: &js_ast::Part,
        part_index: u32,
    ) -> Option<Candidate<'a>> {
        if part.can_be_removed_if_unused || part.tag != js_ast::PartTag::None {
            return None;
        }
        let mut found: Option<Candidate<'a>> = None;
        for stmt in part.stmts.slice() {
            if let StmtData::SExpr(s_expr) = &stmt.data
                && !s_expr.does_not_affect_tree_shaking
                && let Some(candidate) = self.member_assignment(s_expr.value, part_index)
            {
                if found.is_some() {
                    return None;
                }
                found = Some(candidate);
                continue;
            }
            if !self.stmts_can_be_removed_if_unused_without_dce_check(core::slice::from_ref(stmt)) {
                return None;
            }
        }
        found
    }

    /// Needs every real declaration in `top_level_symbols_to_parts` first.
    pub(crate) fn claim_member_assignments(
        &self,
        parts: &mut [js_ast::Part],
        top_level_symbols_to_parts: &mut TopLevelSymbolToParts,
        candidates: &[Candidate<'a>],
    ) {
        if candidates.is_empty() {
            return;
        }
        let mut shapes = ShapeCache::new();
        let mut claimed: BumpVec<'a, Candidate<'a>> = BumpVec::new_in(self.arena);
        for candidate in candidates {
            let Some(shape) = self.owner_shape(
                candidate.owner,
                parts,
                top_level_symbols_to_parts,
                &mut shapes,
            ) else {
                continue;
            };
            let keys = candidate.keys;
            if keys.len() >= 2 {
                // `X.a = other; X.a.b = v` writes through to `other`.
                let aliased = candidates.iter().any(|other| {
                    other.owner == candidate.owner
                        && !other.value_is_fresh
                        && is_proper_prefix(other.keys, keys)
                });
                if aliased {
                    continue;
                }
            }
            if !self.chain_is_owned(shape, keys, parts, top_level_symbols_to_parts, &mut shapes) {
                continue;
            }
            claimed.push(*candidate);
        }

        for candidate in claimed.iter() {
            parts[candidate.part_index as usize].can_be_removed_if_unused = true;
            let list = top_level_symbols_to_parts
                .entry(candidate.owner)
                .or_insert_with(bun_alloc::AstAlloc::vec);
            if !list.contains(&candidate.part_index) {
                list.push(candidate.part_index);
            }
        }
    }

    fn follow_symbol_link(&self, mut ref_: Ref) -> Ref {
        loop {
            let symbol = &self.symbols[ref_.inner_index() as usize];
            if !symbol.has_link() {
                return ref_;
            }
            ref_ = symbol.link.get();
        }
    }

    /// `X.a.b = v` with a side-effect-free `v`, rooted at a local identifier.
    fn member_assignment(&mut self, value: Expr, part_index: u32) -> Option<Candidate<'a>> {
        let ExprData::EBinary(bin) = value.data else {
            return None;
        };
        if bin.op != js_ast::op::Code::BinAssign {
            return None;
        }
        let (root, keys) = Self::member_chain(bin.left, self.arena)?;
        if root.must_keep_due_to_with_stmt() {
            return None;
        }
        if !self.expr_can_be_removed_if_unused_without_dce_check(&bin.right) {
            return None;
        }
        Some(Candidate {
            part_index,
            owner: self.follow_symbol_link(root.ref_),
            keys,
            value_is_fresh: value_is_fresh(&bin.right),
        })
    }

    /// `X.a['b'].c` to `X` and `[a, b, c]`.
    fn member_chain(target: Expr, arena: &'a Bump) -> Option<(E::Identifier, &'a [&'a [u8]])> {
        let mut keys: BumpVec<'a, &'a [u8]> = BumpVec::new_in(arena);
        let mut cur = target;
        loop {
            match cur.data {
                ExprData::EDot(dot) => {
                    if dot.optional_chain.is_some() {
                        return None;
                    }
                    keys.push(dot.name.slice());
                    cur = dot.target;
                }
                ExprData::EIndex(index) => {
                    if index.optional_chain.is_some() {
                        return None;
                    }
                    let ExprData::EString(s) = index.index.data else {
                        return None;
                    };
                    keys.push(key_bytes(&s, arena));
                    cur = index.target;
                }
                ExprData::EIdentifier(id) => {
                    if keys.is_empty() {
                        return None;
                    }
                    keys.reverse();
                    return Some((id, keys.into_bump_slice()));
                }
                _ => return None,
            }
        }
    }

    fn owner_shape(
        &self,
        owner: Ref,
        parts: &[js_ast::Part],
        top_level_symbols_to_parts: &TopLevelSymbolToParts,
        shapes: &mut ShapeCache,
    ) -> Option<OwnerShape> {
        let owner = self.follow_symbol_link(owner);
        if let Some(cached) = shapes.get(&owner) {
            return *cached;
        }
        let shape = self.compute_owner_shape(owner, parts, top_level_symbols_to_parts);
        shapes.insert(owner, shape);
        shape
    }

    fn compute_owner_shape(
        &self,
        owner: Ref,
        parts: &[js_ast::Part],
        top_level_symbols_to_parts: &TopLevelSymbolToParts,
    ) -> Option<OwnerShape> {
        let symbol = &self.symbols[owner.inner_index() as usize];
        if symbol.has_been_assigned_to() {
            return None;
        }
        match symbol.kind {
            js_ast::symbol::Kind::Hoisted
            | js_ast::symbol::Kind::HoistedFunction
            | js_ast::symbol::Kind::GeneratorOrAsyncFunction
            | js_ast::symbol::Kind::Class
            | js_ast::symbol::Kind::Constant
            | js_ast::symbol::Kind::Other => {}
            _ => return None,
        }
        let declaring_parts = top_level_symbols_to_parts.get(&owner)?;
        let [declaring_part] = declaring_parts.as_slice() else {
            return None;
        };
        let mut shape: Option<OwnerShape> = None;
        for stmt in parts[*declaring_part as usize].stmts.slice() {
            let Some(found) = self.declaration_shape(stmt, owner) else {
                continue;
            };
            if shape.is_some() {
                return None;
            }
            shape = Some(found);
        }
        shape
    }

    /// The shape `stmt` gives `owner`, if `stmt` declares it.
    fn declaration_shape(&self, stmt: &Stmt, owner: Ref) -> Option<OwnerShape> {
        match &stmt.data {
            StmtData::SFunction(func) => {
                let name = func.func.name?;
                (self.follow_symbol_link(name.ref_) == owner)
                    .then_some(OwnerShape::Function { is_arrow: false })
            }
            StmtData::SClass(class) => {
                let name = class.class.class_name?;
                (self.follow_symbol_link(name.ref_) == owner)
                    .then_some(OwnerShape::Class(ClassSource::Stmt(*class)))
            }
            StmtData::SLocal(local) => {
                for decl in local.decls.slice() {
                    let js_ast::b::B::BIdentifier(id) = decl.binding.data else {
                        continue;
                    };
                    if self.follow_symbol_link(id.r#ref) != owner {
                        continue;
                    }
                    let value = decl.value?;
                    return match value.data {
                        ExprData::EObject(_) => Some(OwnerShape::Object(value)),
                        ExprData::EClass(class) => {
                            Some(OwnerShape::Class(ClassSource::Expr(class)))
                        }
                        ExprData::EFunction(_) => Some(OwnerShape::Function { is_arrow: false }),
                        ExprData::EArrow(_) => Some(OwnerShape::Function { is_arrow: true }),
                        _ => None,
                    };
                }
                None
            }
            StmtData::SExportDefault(export_default) => match &export_default.value {
                StmtOrExpr::Stmt(inner) => self.declaration_shape(inner, owner),
                StmtOrExpr::Expr(_) => None,
            },
            _ => None,
        }
    }

    /// The write reaches only objects the owner created and runs no accessor.
    fn chain_is_owned(
        &self,
        shape: OwnerShape,
        keys: &[&[u8]],
        parts: &[js_ast::Part],
        top_level_symbols_to_parts: &TopLevelSymbolToParts,
        shapes: &mut ShapeCache,
    ) -> bool {
        match shape {
            OwnerShape::Function { is_arrow } => match keys {
                [_] => true,
                [b"prototype", _] => !is_arrow,
                _ => false,
            },
            OwnerShape::Class(source) => {
                let name = match keys {
                    [name] => *name,
                    [b"prototype", name] => *name,
                    _ => return false,
                };
                self.class_chain_declares_no_accessor(
                    source,
                    name,
                    parts,
                    top_level_symbols_to_parts,
                    shapes,
                )
            }
            OwnerShape::Object(object) => Self::object_literal_owns_path(object, keys, self.arena),
        }
    }

    /// Static or not, on the class or any local class it extends.
    fn class_chain_declares_no_accessor(
        &self,
        source: ClassSource,
        name: &[u8],
        parts: &[js_ast::Part],
        top_level_symbols_to_parts: &TopLevelSymbolToParts,
        shapes: &mut ShapeCache,
    ) -> bool {
        let arena = self.arena;
        let mut current = source;
        for _ in 0..MAX_EXTENDS_DEPTH {
            let class = current.class();
            for property in class.properties.iter() {
                if !matches!(
                    property.kind,
                    PropertyKind::Get | PropertyKind::Set | PropertyKind::AutoAccessor
                ) {
                    continue;
                }
                let Some(key) = property.key else {
                    return false;
                };
                match key.data {
                    ExprData::EString(s) => {
                        if key_bytes(&s, arena) == name {
                            return false;
                        }
                    }
                    // `#name` never collides with a public key.
                    ExprData::EPrivateIdentifier(_) => {}
                    _ => return false,
                }
            }
            let Some(extends) = class.extends else {
                return true;
            };
            let ExprData::EIdentifier(parent) = extends.data else {
                return false;
            };
            let Some(OwnerShape::Class(parent_source)) =
                self.owner_shape(parent.ref_, parts, top_level_symbols_to_parts, shapes)
            else {
                return false;
            };
            current = parent_source;
        }
        false
    }

    /// Each key but the last names a nested literal; the last is no accessor.
    fn object_literal_owns_path(object: Expr, keys: &[&[u8]], arena: &'a Bump) -> bool {
        let mut current = object;
        for (i, key) in keys.iter().enumerate() {
            let ExprData::EObject(literal) = current.data else {
                return false;
            };
            let is_last = i + 1 == keys.len();
            let mut next: Option<Expr> = None;
            for property in literal.properties.slice() {
                if property.kind == PropertyKind::Spread
                    || property.flags.contains(Flags::Property::IsSpread)
                {
                    // A spread copies data properties, never accessors.
                    if is_last {
                        continue;
                    }
                    return false;
                }
                let Some(property_key) = property.key else {
                    return false;
                };
                let ExprData::EString(s) = property_key.data else {
                    if is_last && property.kind == PropertyKind::Normal {
                        continue;
                    }
                    return false;
                };
                let bytes = key_bytes(&s, arena);
                if bytes == b"__proto__" {
                    return false;
                }
                if bytes != *key {
                    continue;
                }
                match property.kind {
                    PropertyKind::Normal => {
                        if !is_last {
                            next = property.value;
                        }
                    }
                    _ => return false,
                }
            }
            if !is_last {
                let Some(n) = next else {
                    return false;
                };
                current = n;
            }
        }
        true
    }
}
