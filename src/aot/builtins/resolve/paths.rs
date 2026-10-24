use super::module_objects::{find_child_module, find_module_object_in};
use super::resolver::{ExprState, HolderKind, ResolvedValue, Resolver};
use super::{BuiltinPath, SourceDialect};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinName, MemberLookup, Mutability,
};
use bun_sema::atom::Atom;
use bun_sema::hir::{ExprId, MemberKey, NodeData};

// No object holds the exports of `bun:bundle` at run time, so no store can replace one.
fn is_erased_namespace(object: BuiltinId) -> bool {
    object == BuiltinId::BunBundle
}

fn member_holder(id: BuiltinId) -> BuiltinId {
    if table::has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT) {
        BuiltinId::GlobalThis
    } else {
        id
    }
}

impl Resolver<'_, '_> {
    pub(super) fn path_of_member(
        &self,
        object: BuiltinId,
        holder_mutability: Mutability,
        found: BuiltinId,
    ) -> Option<BuiltinPath> {
        if !table::exists_on(found, self.input.platform) {
            return None;
        }
        let location = table::entry(found);
        let mut mutability = match is_erased_namespace(object) {
            true => holder_mutability,
            false => holder_mutability.min(location.mutability),
        };
        if location.holder != Some(object) {
            mutability = mutability.min(Mutability::ConstantUnlessWritten);
        }
        Some(BuiltinPath {
            id: table::canonical_id(found),
            mutability,
        })
    }

    fn find_global(&self, name: Atom) -> Option<BuiltinPath> {
        let name = self.input.names.get(name)?;
        let found = table::global(name)?;
        self.path_of_member(BuiltinId::GlobalThis, Mutability::AlwaysLocked, found)
    }

    pub(super) fn find_member(
        &self,
        holder: ResolvedValue,
        name: BuiltinName,
    ) -> Option<BuiltinPath> {
        match holder.kind {
            HolderKind::ModuleNamespace => return self.find_export(holder.path.id, name),
            HolderKind::Object => {}
        }
        let object = table::canonical_id(member_holder(holder.path.id));
        let found = match table::member(object, name) {
            MemberLookup::Found(found) => found,
            MemberLookup::Unknown | MemberLookup::Absent => return None,
        };
        if table::has_flag(found, BuiltinFlags::IS_DEFAULT_EXPORT) {
            return None;
        }
        self.path_of_member(object, holder.path.mutability, found)
    }

    pub(super) fn find_named_member(
        &self,
        holder: ResolvedValue,
        name: Atom,
    ) -> Option<BuiltinPath> {
        self.find_member(holder, self.input.names.get(name)?)
    }

    pub(super) fn resolve_global_path(&mut self, path: &[Atom]) -> ExprState {
        let Some((&first, rest)) = path.split_first() else {
            return ExprState::Unresolved;
        };
        let Some(mut current) = self.find_global(first) else {
            return ExprState::Unresolved;
        };
        self.output.mentioned.push(current.id);
        for &name in rest {
            let Some(found) = self.find_named_member(ResolvedValue::object(current), name) else {
                return ExprState::Unresolved;
            };
            self.output.mentioned.push(found.id);
            current = found;
        }
        ExprState::of_path(Some(current))
    }

    pub(super) fn compute_free_name_state(&self, expr: ExprId, name: Atom) -> ExprState {
        let input = self.input;
        if input
            .bound
            .dynamic_lookup_scope(NodeData::Expr(expr))
            .is_some()
        {
            return match self.find_global(name) {
                Some(path) => {
                    ExprState::DynamicGlobal(ResolvedValue::object(path).predicted().path)
                }
                None => ExprState::Unresolved,
            };
        }
        if input.dialect == SourceDialect::Runtime
            && let Some(intrinsic) = self.find_runtime_free_name(expr, name)
        {
            return ExprState::Intrinsic(intrinsic);
        }
        ExprState::of_path(self.find_global(name))
    }

    fn find_key_name(&self, key: MemberKey) -> Option<(BuiltinName, Mutability)> {
        match key {
            MemberKey::Name(name) => Some((self.input.names.get(name)?, Mutability::AlwaysLocked)),
            MemberKey::Computed(computed) => {
                let key = self.value_of(computed)?.path;
                let symbol = table::well_known_symbol(key.id)?;
                Some((table::name_of_symbol(symbol), key.mutability))
            }
            MemberKey::PrivateName(_) => None,
        }
    }

    pub(super) fn compute_member_state(&self, expr: ExprId) -> ExprState {
        let input = self.input;
        let Some((object, key)) = input.hir.member_key(expr) else {
            return ExprState::Unresolved;
        };
        if input.dialect == SourceDialect::Runtime
            && let MemberKey::Name(name) = key
            && let Some(intrinsic) = self.find_runtime_member(name)
        {
            return ExprState::Intrinsic(intrinsic);
        }
        let held = self.held_value_of(object);
        let known = self.value_of(object).or(held);
        let Some(holder) = known.or_else(|| self.find_made_require(object)) else {
            return ExprState::Unresolved;
        };
        if let Some(child) = find_child_module(holder, key) {
            return ExprState::Held(child);
        }
        let module_object = find_module_object_in(holder);
        let is_held = held.is_some() || known.is_none() || module_object.is_some();
        let holder = module_object.unwrap_or(holder);
        let Some((name, key_mutability)) = self.find_key_name(key) else {
            return ExprState::Unresolved;
        };
        let Some(path) = self.find_member(holder, name) else {
            return ExprState::Unresolved;
        };
        let member = ResolvedValue::object(BuiltinPath {
            id: path.id,
            mutability: path.mutability.min(key_mutability),
        });
        match is_held {
            true => ExprState::Held(member),
            false => ExprState::Builtin(member),
        }
    }
}
