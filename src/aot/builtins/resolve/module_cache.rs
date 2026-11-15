use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::resolver::{ResolvedValue, Resolver};
use super::written_members::holder_of;
use super::{BuiltinPath, SourceDialect};
use crate::builtins::table::{self, BuiltinId, BuiltinName, Mutability};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, MemberKey, PropKey};
use bun_sema::util::FxHashSet;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KeyOfModuleCache {
    Text(Atom),
    Computed(ExprId),
}

pub fn is_module_cache(id: BuiltinId) -> bool {
    let tables = [
        BuiltinId::ModuleRequireCache,
        BuiltinId::ModuleRequirePrototypeCache,
        BuiltinId::NodeModule_cache,
    ];
    (tables.map(table::canonical_id)).contains(&table::canonical_id(id))
}

pub(super) fn name_of_module_cache() -> BuiltinName {
    table::entry(BuiltinId::ModuleRequireCache).name
}

pub fn is_table_of_loaders(id: BuiltinId) -> bool {
    let tables = [
        BuiltinId::ModuleRequireExtensions,
        BuiltinId::ModuleRequirePrototypeExtensions,
        BuiltinId::NodeModule_extensions,
    ];
    (tables.map(table::canonical_id)).contains(&table::canonical_id(id))
}

pub(super) fn is_function_that_loader_calls(id: BuiltinId) -> bool {
    let functions = [
        BuiltinId::NodeModule_resolveFilename,
        BuiltinId::NodeModulePrototypeRequire,
    ];
    (functions.map(table::canonical_id)).contains(&table::canonical_id(id))
}

impl Resolver<'_, '_> {
    pub(super) fn note_use_of_function_that_loader_calls(&mut self, function: ExprId) {
        if self.is_stored_to(function) {
            self.expose(BuiltinId::NodeModule);
            self.expose(BuiltinId::ModuleObject);
        }
    }

    pub(super) fn note_use_of_table_of_loaders(&mut self, table: ExprId) {
        let may_be_written = match self.find_member_of(table) {
            Some(loader) => self.is_deleted(loader) || self.is_stored_to(loader),
            None => match self.classify_use(table) {
                MentionUse::Inspected
                | MentionUse::Holder
                | MentionUse::ReadByComputedKey
                | MentionUse::Aliased => false,
                MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => true,
            },
        };
        if may_be_written && self.input.dialect == SourceDialect::Program {
            self.output.tables_of_loaders_written.push(table);
        }
        self.output.loses_sight_of_module_cache |= may_be_written;
    }

    /// `Object.assign(Module, hooks)`, `lay(Module)`, `Module[name] = hook`, `lay(require)`: whoever holds the object may store a function for the loader.
    pub(super) fn note_holder_of_loader_functions_out_of_sight(
        &mut self,
        holder: ExprId,
        id: BuiltinId,
    ) {
        let mut members = table::members(holder_of(id)).iter();
        if self.input.dialect == SourceDialect::Program
            && members.any(|&it| is_function_that_loader_calls(it) || is_table_of_loaders(it))
        {
            self.output.tables_of_loaders_written.push(holder);
        }
        if self.input.dialect == SourceDialect::Program
            && (table::members(holder_of(id)).iter()).any(|&it| is_module_cache(it))
        {
            self.output.places_that_hand_module_cache_on.push(holder);
            if self.assigns_module_cache_to_name(holder, id) {
                self.output.passed_module_caches.push(holder);
            }
        }
    }

    /// `({ cache } = require)`
    fn assigns_module_cache_to_name(&self, holder: ExprId, id: BuiltinId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let Parent::Expr(user) = bound.parent_of_expr(self.outermost_assertion_of(holder)) else {
            return false;
        };
        let ExprKind::Assign {
            op: None, target, ..
        } = hir[user].kind
        else {
            return false;
        };
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(target)].kind else {
            return false;
        };
        let object = ResolvedValue::object(BuiltinPath {
            id,
            mutability: Mutability::ChangesOnItsOwn,
        });
        properties.iter().any(|property| match hir[property].key {
            PropKey::Name(name) => (self.find_named_member(object, name))
                .is_some_and(|member| is_module_cache(member.id)),
            _ => true,
        })
    }

    fn find_deleting_call(&self, table: ExprId) -> Option<(ExprId, ExprId)> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut operand = table;
        while let Parent::Expr(parent) = bound.parent_of_expr(operand)
            && hir.type_assertion_operand(parent) == Some(operand)
        {
            operand = parent;
        }
        let Parent::Expr(user) = bound.parent_of_expr(operand) else {
            return None;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let mut operands = hir.ids(hir[call].args);
        let is_deletion = mentioned_id(self.state(callee)).map(table::canonical_id)
            == Some(BuiltinId::ReflectDeleteProperty);
        let key = (operands.next() == Some(operand)).then(|| operands.next())?;
        key.filter(|&key: &ExprId| is_deletion && !matches!(hir[key].kind, ExprKind::Spread(_)))
            .map(|key| (user, key))
    }

    pub(super) fn is_stored_to(&self, entry: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut target = entry;
        while let Parent::Expr(parent) = bound.parent_of_expr(target)
            && hir.type_assertion_operand(parent) == Some(target)
        {
            target = parent;
        }
        bound.get_assignment_target(hir, target).is_some()
    }

    fn is_let_out_of_sight(&self, object: ExprId) -> bool {
        match self.classify_use(object) {
            MentionUse::Inspected
            | MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Destructured(_) => false,
            MentionUse::Called(_) | MentionUse::Aliased | MentionUse::Exposed => true,
        }
    }

    fn find_variables_let_out_of_sight(&self) -> FxHashSet<SymbolId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let names = (0..hir.exprs.len() as u32).map(ExprId);
        let names = names.filter(|&name| matches!(hir[name].kind, ExprKind::Ident(_)));
        let variables = names.filter_map(|name| match bound.binding(name) {
            Binding::Symbol(variable) if self.is_let_out_of_sight(name) => Some(variable),
            _ => None,
        });
        variables.collect()
    }

    fn find_variable_initialized_by(&self, entry: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut initializer = entry;
        while let Parent::Expr(parent) = bound.parent_of_expr(initializer)
            && hir.type_assertion_operand(parent) == Some(initializer)
        {
            initializer = parent;
        }
        let Parent::VarInit(declarator) = bound.parent_of_expr(initializer) else {
            return None;
        };
        match bound.initialized_binding(hir[declarator].pat) {
            Binding::Symbol(variable) => Some(variable),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        }
    }

    fn is_entry_handed_on(&self, entry: ExprId) -> bool {
        if !matches!(self.classify_use(entry), MentionUse::Aliased) {
            return self.is_let_out_of_sight(entry);
        }
        let Some(variable) = self.find_variable_initialized_by(entry) else {
            return true;
        };
        let let_out = &self.variables_let_out_of_sight;
        (let_out.get_or_init(|| self.find_variables_let_out_of_sight())).contains(&variable)
    }

    /// `require.cache[key]` in a file whose direct eval may replace `require`: the keys that the file spells count all the same.
    pub(super) fn note_cache_of_unresolved_require(&mut self, require: ExprId) {
        let Some(table) = self.find_member_of(require) else {
            return;
        };
        let Some((_, MemberKey::Name(name))) = self.input.hir.member_key(table) else {
            return;
        };
        let object = ResolvedValue::object(BuiltinPath {
            id: BuiltinId::ModuleRequire,
            mutability: Mutability::ChangesOnItsOwn,
        });
        let member = self.find_named_member(object, name);
        if member.is_some_and(|member| is_module_cache(member.id)) {
            self.note_use_of_module_cache(table);
        }
    }

    pub(super) fn note_use_of_module_cache(&mut self, table: ExprId) {
        let hir = self.input.hir;
        if let Some(entry) = self.find_member_of(table) {
            let is_deleted = self.is_deleted(entry);
            if is_deleted {
                self.output.entries_deleted_from_module_cache.push(entry);
            }
            let is_stored_to = self.is_stored_to(entry);
            if is_stored_to {
                self.output.entries_stored_in_module_cache.push(entry);
            }
            let is_taken_out = is_deleted || is_stored_to;
            let is_handed_on =
                !is_taken_out && self.input.runs_tests && self.is_entry_handed_on(entry);
            if is_taken_out || is_handed_on {
                let key = match hir.member_key(entry) {
                    Some((_, MemberKey::Name(text) | MemberKey::PrivateName(text))) => {
                        KeyOfModuleCache::Text(text)
                    }
                    Some((_, MemberKey::Computed(key))) => KeyOfModuleCache::Computed(key),
                    None => unreachable!("find_member_of answers with an access"),
                };
                match is_taken_out {
                    true => self.output.keys_taken_out_of_module_cache.push(key),
                    false => self.output.keys_of_entries_handed_on.push(key),
                }
            }
            self.output.gets_at_entries_of_module_cache = true;
            return;
        }
        if let Some((deletion, key)) = self.find_deleting_call(table) {
            self.output.entries_deleted_from_module_cache.push(deletion);
            let key = match hir.index_member_key(hir.skip_type_assertions(key)) {
                MemberKey::Name(text) | MemberKey::PrivateName(text) => {
                    KeyOfModuleCache::Text(text)
                }
                MemberKey::Computed(key) => KeyOfModuleCache::Computed(key),
            };
            self.output.gets_at_entries_of_module_cache = true;
            return self.output.keys_taken_out_of_module_cache.push(key);
        }
        let mention_use = self.classify_use(table);
        let gets_at_entries = !matches!(mention_use, MentionUse::Aliased);
        self.output.gets_at_entries_of_module_cache |= gets_at_entries;
        let is_handed_on = match mention_use {
            MentionUse::Inspected
            | MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Aliased => false,
            MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => true,
        };
        self.output.loses_sight_of_module_cache |= is_handed_on;
        self.output.hands_module_cache_on |= is_handed_on;
        if is_handed_on && self.input.dialect == SourceDialect::Program {
            self.output.places_that_hand_module_cache_on.push(table);
            self.output.passed_module_caches.push(table);
        }
    }
}
