use super::module_objects::{find_listed_module, find_module_object_in};
use super::resolver::{ExprState, HolderKind, ResolvedValue, Resolver};
use super::{BUN_OF_TEST_FILE, BuiltinPath, SourceDialect};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinName, MemberLookup, Mutability,
};
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{ExprId, ExprKind, Flags, MemberKey, NodeData, PropKey};

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

pub(super) struct KeyName {
    pub(super) name: BuiltinName,
    mutability: Mutability,
    has_side_effects: bool,
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
        if location.holder != Some(object)
            || self.input.replaced.binary_search(&(found as u32)).is_ok()
        {
            mutability = mutability.min(Mutability::ConstantUnlessWritten);
        }
        Some(BuiltinPath {
            id: table::canonical_id(found),
            mutability,
        })
    }

    pub(super) fn find_global(&self, name: Atom) -> Option<BuiltinPath> {
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

    pub(super) fn find_holder_above_function_written_here(
        &self,
        written: ExprId,
    ) -> Option<ResolvedValue> {
        if !self.input.runs_tests {
            return None;
        }
        let hir = self.input.hir;
        let ExprKind::Fn(function) = hir[hir.skip_type_assertions(written)].kind else {
            return None;
        };
        let flags = hir[function].flags;
        let id = match (
            flags.contains(Flags::ASYNC),
            flags.contains(Flags::GENERATOR),
        ) {
            (false, false) => BuiltinId::FunctionPrototype,
            (true, false) => BuiltinId::AsyncFunctionPrototype,
            (false, true) => BuiltinId::GeneratorFunctionPrototype,
            (true, true) => BuiltinId::AsyncGeneratorFunctionPrototype,
        };
        let holder = ResolvedValue::object(BuiltinPath {
            id,
            mutability: Mutability::ConstantUnlessWritten,
        });
        Some(holder.with_side_effects())
    }

    pub(super) fn find_holder_that_proto_of_value_written_here_names(
        &self,
        written: ExprId,
    ) -> Option<ResolvedValue> {
        if !self.input.runs_tests {
            return None;
        }
        let hir = self.input.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(written)].kind else {
            return self.find_holder_above_function_written_here(written);
        };
        let mut keys = properties.iter().map(|property| hir[property].key);
        if keys.any(|key| key == PropKey::Name(known::__proto__)) {
            return None;
        }
        let holder = ResolvedValue::object(BuiltinPath {
            id: BuiltinId::ObjectPrototype,
            mutability: Mutability::ConstantUnlessWritten,
        });
        Some(holder.with_side_effects())
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
        self.mention(current.id);
        for &name in rest {
            let Some(found) = self.find_named_member(ResolvedValue::object(current), name) else {
                return ExprState::Unresolved;
            };
            self.mention(found.id);
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

    pub(super) fn find_key_name(&self, key: MemberKey) -> Option<KeyName> {
        match key {
            MemberKey::Name(name) => Some(KeyName {
                name: self.input.names.get(name)?,
                mutability: Mutability::AlwaysLocked,
                has_side_effects: false,
            }),
            MemberKey::Computed(computed) => {
                let (key, symbol) = self.symbol_that_key_is(computed)?;
                let key = match self.input.runs_tests {
                    true => key.predicted(),
                    false => key,
                };
                Some(KeyName {
                    name: table::name_of_symbol(symbol),
                    mutability: key.path.mutability,
                    has_side_effects: key.has_side_effects,
                })
            }
            MemberKey::PrivateName(_) => None,
        }
    }

    fn is_bun_of_test_file(&self, object: ExprId) -> bool {
        let input = self.input;
        let object = input.hir.skip_type_assertions(object);
        matches!(input.hir[object].kind, ExprKind::Ident(name) if input.atoms.bytes(name) == BUN_OF_TEST_FILE)
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
        let (held, known) = match self.is_resolved(input.hir.skip_type_assertions(object)) {
            true => {
                let held = self.held_value_of(object);
                (held, self.value_of(object).or(held))
            }
            false => (None, None),
        };
        if known.is_none()
            && key == MemberKey::Name(known::__proto__)
            && let Some(above) = self.find_holder_that_proto_of_value_written_here_names(object)
        {
            return ExprState::Held(above);
        }
        let above = match known {
            Some(_) => None,
            None => self.find_holder_above_function_written_here(object),
        };
        let Some(holder) = known.or_else(|| self.find_made_require(object)).or(above) else {
            return ExprState::Unresolved;
        };
        if let Some(listed) = find_listed_module(holder, key) {
            return ExprState::Held(listed);
        }
        if input.dialect == SourceDialect::Runtime
            && holder.path.id == BuiltinId::GlobalThis
            && let MemberKey::Name(name) = key
            && let Some(intrinsic) = self.find_native(name, true)
        {
            return ExprState::Intrinsic(intrinsic);
        }
        let module_object = find_module_object_in(holder);
        let is_held = held.is_some() || known.is_none() || module_object.is_some();
        let has_side_effects = holder.has_side_effects;
        let holder = module_object.unwrap_or(holder);
        let Some(key) = self.find_key_name(key) else {
            return ExprState::Unresolved;
        };
        let Some(path) = self.find_member(holder, key.name) else {
            return ExprState::Unresolved;
        };
        if table::canonical_id(path.id) == table::canonical_id(BuiltinId::BunJest)
            && self.is_bun_of_test_file(object)
        {
            return ExprState::of_path(Some(BuiltinPath {
                id: BuiltinId::CompilerHelpersAskRunOfTestFile,
                mutability: Mutability::AlwaysLocked,
            }));
        }
        if above.is_some() && table::has_flag(path.id, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES) {
            return ExprState::Unresolved;
        }
        let member = ResolvedValue::object(BuiltinPath {
            id: path.id,
            mutability: path.mutability.min(key.mutability),
        });
        let member = match has_side_effects || key.has_side_effects {
            true => member.with_side_effects(),
            false => member,
        };
        match is_held {
            true => ExprState::Held(member),
            false => ExprState::Builtin(member),
        }
    }
}
