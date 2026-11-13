use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingKind, CommonJsVariable, Decl, InitialState, ScopeId, ScopeKind, SymbolId,
    has_simple_parameter_list,
};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::Flags;
use bun_sema::program::{FileId, Sym};
use bun_sema::util::FxHashMap;
use smallvec::SmallVec;

use super::{BindingRef, ScopeSlot, Storage, dead_zone};
use crate::builtins::id::BuiltinId;
use crate::builtins::{BuiltinPath, Mutability};
use crate::ir::generated::{Field, FieldFlags, ImportPhase, Layout, LayoutKind};
use crate::ir::{
    ClassSlot, DeclaredType, LayoutId, LayoutKey, Mapped, OpaqueKind, PositionFlags, Primitives,
    PropertyKey, StringId, Type, TypeId, TypeTable,
};
use crate::lower::{FileLowering, class};
use crate::modules::{ModuleKind, ModuleRef, ReexportPath};

pub(in crate::lower) fn environment_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    scope: ScopeId,
) -> LayoutId {
    let layout = file.fragment.declare_layout(LayoutKey::Environment {
        file: file.file,
        environment: scope.0,
    });
    if file.fragment.is_layout_defined(layout) {
        return layout;
    }
    let bindings = file.scopes.environment_fields(scope);
    let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
    let mut fields = Vec::with_capacity(bindings.len());
    for (index, &binding) in bindings.iter().enumerate() {
        fields.push(file.create_environment_field(binding, index));
    }
    if !file.fragment.is_layout_defined(layout) {
        let definition = Layout {
            kind: LayoutKind::Environment,
            module: Some(file.module_id()),
            fields,
            place: Some(file.scopes.bindings_declared_in_front_of(scope)),
            ..Layout::default()
        };
        file.fragment.define_layout(layout, definition);
    }
    layout
}

pub(in crate::lower) fn instance_layout(file: &mut FileLowering<'_, '_, '_, '_>) -> LayoutId {
    let key = LayoutKey::ModuleInstance(file.file);
    let layout = file.fragment.declare_layout(key);
    if file.fragment.is_layout_defined(layout) {
        return layout;
    }
    let modules = file.inputs.modules;
    let fields_of_instance = modules.instance_layout(file.file);
    let fields_of_instance = fields_of_instance.expect("only a reloadable ES module has instances");
    let scope = file.bound.scope_of_declaration(file.hir, Decl::File);
    let mut fields = Vec::new();
    for &symbol in fields_of_instance.exports() {
        let mut field = file.create_environment_field(BindingRef::Symbol(symbol), fields.len());
        field.flags = field.flags.without(FieldFlags::IS_REQUIRED);
        if !field.flags.contains(FieldFlags::IS_IMMUTABLE) && file.is_replaceable(symbol) {
            field.flags |= FieldFlags::IS_REPLACEABLE;
        }
        let mut hoisted = file.scopes.hoisted_functions(scope).iter();
        let stays_declared_function =
            field.flags.contains(FieldFlags::IS_IMMUTABLE) && hoisted.any(|it| it.0 == symbol);
        if file.is_export_that_code_fills(symbol) && !stays_declared_function {
            let types = &mut file.fragment.types;
            field.declared.ty = types.union(field.declared.ty, TypeTable::ABSENT);
        }
        fields.push(field);
    }
    for &target in fields_of_instance.links() {
        fields.push(file.create_link_field(fields.len(), target));
    }
    let namespaces = [ImportPhase::Evaluation, ImportPhase::Defer];
    for _ in fields_of_instance.mocks() {
        fields.push(file.create_word_field(fields.len()));
    }
    for _ in namespaces {
        let types = &mut file.fragment.types;
        let ty = types.union(TypeTable::ANYTHING, TypeTable::ABSENT);
        fields.push(file.create_hidden_field(fields.len(), ty));
    }
    let ty = match file.scopes.has_environment(scope) {
        true => {
            let environment = environment_layout(file, scope);
            file.fragment.types.intern(Type::environment(environment))
        }
        false => TypeTable::ABSENT,
    };
    fields.push(file.create_immutable_field(fields.len(), ty));
    for &path in fields_of_instance.reexports() {
        let target = file.inputs.modules.path_step(path).target;
        fields.push(file.create_link_field(fields.len(), target));
    }
    if !file.fragment.is_layout_defined(layout) {
        let definition = Layout {
            kind: LayoutKind::Environment,
            module: Some(file.module_id()),
            fields,
            place: Some(0),
            ..Layout::default()
        };
        file.fragment.define_layout(layout, definition);
    }
    layout
}

/// The fields after the layout of the file's module instance that its code has requested: the links that lead along a
/// path of files to the instance of the last one, and copies of the mock words that the instance of the last file of a
/// path holds for a module. A path begins with a module that the file itself requests.
#[derive(Default)]
pub(in crate::lower) struct ResolvedFields {
    pub links: Vec<(ReexportPath, u32)>,
    pub words: Vec<(Vec<FileId>, ModuleRef, u32)>,
    import_meta: Option<u32>,
    fields_of_links: FxHashMap<ReexportPath, u32>,
    fields_of_words: FxHashMap<(ReexportPath, ModuleRef), u32>,
}

impl ResolvedFields {
    pub(in crate::lower) fn is_used(&self) -> bool {
        !self.links.is_empty() || !self.words.is_empty() || self.import_meta.is_some()
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn create_link_field(&mut self, index: usize, target: FileId) -> Field {
        let linked = LayoutKey::ModuleInstance(target);
        let linked = self.fragment.declare_layout(linked);
        let ty = self.fragment.types.intern(Type::environment(linked));
        self.create_immutable_field(index, ty)
    }

    fn create_word_field(&mut self, index: usize) -> Field {
        self.create_immutable_field(index, TypeTable::ANYTHING)
    }

    fn create_immutable_field(&mut self, index: usize, ty: TypeId) -> Field {
        let field = self.create_hidden_field(index, ty);
        Field {
            flags: field.flags | FieldFlags::IS_IMMUTABLE,
            ..field
        }
    }

    fn count_instance_fields(&self) -> usize {
        let fields = self.inputs.modules.instance_layout(self.file);
        let fields = fields.expect("only a reloadable ES module has instances");
        let resolved = self.resolved_fields.links.len() + self.resolved_fields.words.len();
        let import_meta = usize::from(self.resolved_fields.import_meta.is_some());
        fields.field_of_scope() as usize + 1 + fields.reexports().len() + resolved + import_meta
    }

    pub(in crate::lower) fn ensure_import_meta_field(&mut self) -> u32 {
        if let Some(field) = self.resolved_fields.import_meta {
            return field;
        }
        let layout = instance_layout(self);
        let types = &mut self.fragment.types;
        let ty = types.union(TypeTable::ANYTHING, TypeTable::ABSENT);
        let field = self.create_hidden_field(self.count_instance_fields(), ty);
        let field = self.fragment.add_layout_field(layout, field);
        self.resolved_fields.import_meta = Some(field);
        field
    }

    pub(in crate::lower) fn ensure_link_along(&mut self, path: &[FileId]) -> u32 {
        let modules = self.inputs.modules;
        let path = modules.intern_path(path).expect("a path has a file");
        let known = self.resolved_fields.fields_of_links.get(&path).copied();
        if let Some(field) = modules.field_of_path(self.file, path).or(known) {
            return field;
        }
        let layout = instance_layout(self);
        let target = modules.path_step(path).target;
        let field = self.create_link_field(self.count_instance_fields(), target);
        let field = self.fragment.add_layout_field(layout, field);
        self.resolved_fields.fields_of_links.insert(path, field);
        self.resolved_fields.links.push((path, field));
        field
    }

    /// The field that holds the mock of `target` for the last file of `path`. An empty path means the file itself.
    pub(in crate::lower) fn ensure_mock_word(
        &mut self,
        path: &[FileId],
        target: ModuleRef,
    ) -> Option<u32> {
        let modules = self.inputs.modules;
        let holder = path.last().copied().unwrap_or(self.file);
        let of_holder = modules.instance_layout(holder)?.field_of_mock(target)?;
        let Some(known_path) = modules.intern_path(path) else {
            return Some(of_holder);
        };
        let words = &self.resolved_fields.fields_of_words;
        if let Some(&known) = words.get(&(known_path, target)) {
            return Some(known);
        }
        let layout = instance_layout(self);
        let field = self.create_word_field(self.count_instance_fields());
        let field = self.fragment.add_layout_field(layout, field);
        let words = &mut self.resolved_fields.fields_of_words;
        words.insert((known_path, target), field);
        (self.resolved_fields.words).push((path.to_vec(), target, field));
        Some(field)
    }

    fn create_hidden_field(&mut self, index: usize, ty: TypeId) -> Field {
        let label = format!("{index}");
        let label = self.intern_bytes(label.as_bytes());
        let key = PropertyKey::from_engine_private_name(label);
        Field {
            key: Some(self.fragment.property_keys.intern(key)),
            declared: DeclaredType::from_compiler(ty),
            ..Field::default()
        }
    }

    pub(in crate::lower) fn stored_position(&mut self, binding: BindingRef) -> DeclaredType {
        let symbol = match binding {
            BindingRef::Symbol(symbol) => symbol,
            BindingRef::Slot(scope, slot) => return self.slot_position(scope, slot),
        };
        if self.inputs.modules.holder(self.file, symbol).is_some() {
            return DeclaredType::untyped();
        }
        if self.is_replaceable(symbol) {
            return DeclaredType::untyped();
        }
        let position = self.binding_position(symbol);
        let path = self.builtins.of_symbol(symbol);
        self.expect_builtin_path(position, path)
    }

    pub(super) fn location_position(&mut self, binding: BindingRef) -> DeclaredType {
        let mut position = self.stored_position(binding);
        if let BindingRef::Symbol(id) = binding {
            let file = self.file;
            if self.holds_prototype_of_maker(id) {
                position = DeclaredType::untyped();
            } else if position.ty == TypeTable::ANYTHING
                && self.inputs.modules.holder(file, id).is_none()
            {
                position = self.compute_inferred_position(Sym { file, id });
            }
        }
        if dead_zone::has_dead_zone(self, binding) {
            position.ty = self.fragment.types.union(position.ty, TypeTable::ABSENT);
        }
        position
    }

    /// Whether an outer scope's environment holds the binding.
    fn is_held_by_outer_scope(&self, binding: BindingRef) -> bool {
        let declaring = match binding {
            BindingRef::Symbol(symbol) => self.bound.symbol_scope(symbol),
            BindingRef::Slot(scope, _) => scope,
        };
        let placement = self.scopes.placement(binding);
        matches!(
            placement.map(|placement| placement.storage),
            Some(Storage::Field { scope, .. }) if declaring.is_some() && scope != declaring
        )
    }

    pub(super) fn is_listed_at_allocation(&self, binding: BindingRef) -> bool {
        if dead_zone::has_dead_zone(self, binding) || self.is_held_by_outer_scope(binding) {
            return false;
        }
        match binding {
            BindingRef::Symbol(symbol) => match self.bound.initial_state(symbol) {
                InitialState::Uninitialized => false,
                InitialState::Undefined => true,
                InitialState::Initialized => self.is_simple_parameter(symbol),
            },
            BindingRef::Slot(_, slot) => !matches!(slot, ScopeSlot::Class(_)),
        }
    }

    fn is_simple_parameter(&self, symbol: SymbolId) -> bool {
        let bound = self.bound;
        if bound.binding_kind(symbol) != BindingKind::Parameter {
            return false;
        }
        let ScopeKind::Fn(function) = bound.scopes[bound.symbol_scope(symbol).idx()].kind else {
            return false;
        };
        has_simple_parameter_list(self.hir, function)
    }

    fn create_environment_field(&mut self, binding: BindingRef, index: usize) -> Field {
        let label = format!("{index}");
        let label = self.intern_bytes(label.as_bytes());
        let key = PropertyKey::from_engine_private_name(label);
        let key = self.fragment.property_keys.intern(key);
        let placement = self.scopes.placement(binding);
        let mut flags = FieldFlags::default();
        if self.is_listed_at_allocation(binding) {
            flags |= FieldFlags::IS_REQUIRED;
        }
        if placement.is_some_and(|placement| placement.is_immutable) {
            flags |= FieldFlags::IS_IMMUTABLE;
        }
        let declared = self.location_position(binding);
        Field {
            key: Some(key),
            declared: self.mark_variable_of_module(binding, declared),
            flags,
            variable_name: self.written_name(binding),
            ..Field::default()
        }
    }

    pub(in crate::lower) fn mark_variable_of_module(
        &self,
        binding: BindingRef,
        mut declared: DeclaredType,
    ) -> DeclaredType {
        let BindingRef::Symbol(symbol) = binding else {
            return declared;
        };
        let file_scope = self.bound.scope_of_declaration(self.hir, Decl::File);
        let scope = self.bound.symbol_scope(symbol).some().unwrap_or(file_scope);
        if scope == file_scope && self.inputs.modules.kind(self.file) == ModuleKind::SourceText {
            declared.flags |= PositionFlags::IS_VARIABLE_OF_MODULE;
        }
        declared
    }

    pub(in crate::lower) fn written_name(&mut self, binding: BindingRef) -> Option<StringId> {
        match binding {
            BindingRef::Symbol(symbol) => {
                let name = self.bound.symbol(symbol).name;
                (name != Atom::NONE).then(|| {
                    self.short_binding_name(Binding::Symbol(symbol))
                        .unwrap_or_else(|| self.intern_atom(name))
                })
            }
            BindingRef::Slot(_, ScopeSlot::This) => Some(self.intern_bytes(b"this")),
            BindingRef::Slot(_, ScopeSlot::Arguments) => Some(self.intern_bytes(b"arguments")),
            BindingRef::Slot(..) => None,
        }
    }

    fn slot_position(&mut self, scope: ScopeId, slot: ScopeSlot) -> DeclaredType {
        match slot {
            ScopeSlot::This => this_position(self, scope),
            ScopeSlot::NewTarget
            | ScopeSlot::ArgumentsBinding
            | ScopeSlot::Class(ClassSlot::DecoratorState | ClassSlot::PrivateMethod(_)) => {
                DeclaredType::untyped()
            }
            ScopeSlot::Callee => DeclaredType::from_compiler(TypeTable::FUNCTION),
            ScopeSlot::Class(ClassSlot::ClassObject) => {
                let ScopeKind::Class(class) = self.bound.scopes[scope.idx()].kind else {
                    unreachable!("a class slot belongs to the scope of its class");
                };
                self.class_object_position(class)
            }
            ScopeSlot::CommonJs(variable) => {
                if variable == CommonJsVariable::Exports
                    && let Some(position) = self.own_exports_position()
                {
                    return position;
                }
                let path = self.builtins.commonjs_variable(variable);
                self.expect_builtin_path(DeclaredType::untyped(), path)
            }
            ScopeSlot::ModuleInstance => {
                let layout = LayoutKey::ModuleInstance(self.file);
                let layout = self.fragment.declare_layout(layout);
                DeclaredType::from_compiler(self.fragment.types.intern(Type::environment(layout)))
            }
            ScopeSlot::Class(ClassSlot::ClassToken) => {
                let token = Type::opaque(OpaqueKind::ClassToken);
                DeclaredType::from_compiler(self.fragment.types.intern(token))
            }
            ScopeSlot::Class(ClassSlot::ComputedKey(_)) => {
                let types = &mut self.fragment.types;
                DeclaredType::from_compiler(types.union(TypeTable::STRING, TypeTable::SYMBOL))
            }
            ScopeSlot::Class(ClassSlot::StaticField(member)) => {
                let ScopeKind::Class(class) = self.bound.scopes[scope.idx()].kind else {
                    unreachable!("a class slot belongs to the scope of its class");
                };
                class::static_field_position(self, class, member)
            }
            _ => DeclaredType::from_compiler(TypeTable::OBJECT),
        }
    }

    fn own_exports_position(&mut self) -> Option<DeclaredType> {
        let layout = self.module_exports_layout(self.file)?;
        let exports = Mapped::expected(self.fragment.types.intern_layout(layout));
        Some(DeclaredType::new(exports, None, PositionFlags::default()))
    }

    fn converted_this_position(&mut self, entry: DeclaredType) -> DeclaredType {
        let types = &mut self.fragment.types;
        let objects = types.without_primitives(entry.ty, Primitives::ALL);
        if objects == TypeTable::OBJECT || objects == TypeTable::NEVER {
            return DeclaredType::from_compiler(TypeTable::OBJECT);
        }
        let mapped = match entry.is_expected() {
            true => Mapped::expected(objects),
            false => Mapped::checked(objects),
        };
        DeclaredType::new(mapped, entry.site, PositionFlags::default())
    }

    fn expect_builtin_path(
        &mut self,
        position: DeclaredType,
        path: Option<BuiltinPath>,
    ) -> DeclaredType {
        let Some(path) = path else {
            return position;
        };
        if path.mutability < Mutability::ConstantUnlessWritten {
            return position;
        }
        let is_expected = position.is_expected();
        if !is_expected && position.ty != TypeTable::ANYTHING {
            return position;
        }
        let own_exports = match path.id == BuiltinId::ModuleObjectExports {
            true => self.own_exports_position(),
            false => None,
        };
        let types = &mut self.fragment.types;
        let builtin = match (own_exports, Type::value_of_builtin(path.id)) {
            (Some(exports), _) => exports.ty,
            (None, Some(builtin)) => types.intern(builtin),
            (None, None) => return position,
        };
        let expected = match is_expected {
            true => types.union(position.ty, builtin),
            false => builtin,
        };
        DeclaredType::new(Mapped::expected(expected), position.site, position.flags)
    }
}

fn this_position(file: &mut FileLowering<'_, '_, '_, '_>, scope: ScopeId) -> DeclaredType {
    let bound = file.bound;
    match bound.scopes[scope.idx()].kind {
        ScopeKind::Fn(function) => {
            let position = file.function_positions(function).this;
            match bound.is_strict_scope(scope) {
                true => position,
                false => file.converted_this_position(position),
            }
        }
        ScopeKind::FieldInitializer(member) => {
            let class = bound.member_class(member);
            let class = class.expect("a field initializer belongs to a member of a class");
            let is_static = file.hir[member].flags.contains(Flags::STATIC);
            if !is_static && class::is_called_by_evaluated_text(file, class) {
                return DeclaredType::untyped();
            }
            let class = ClassRef {
                file: file.file,
                class,
            };
            file.class_this_type(class, Some(member))
        }
        ScopeKind::File => file
            .own_exports_position()
            .unwrap_or_else(DeclaredType::untyped),
        _ => DeclaredType::untyped(),
    }
}
