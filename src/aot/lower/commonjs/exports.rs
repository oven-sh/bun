use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CodeUnit, CommonJsVariable, Decl, InitialState, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ExprId, ExprKind, FnId, MemberKey, PatKind, PropKey, PropKind, StmtId};
use bun_sema::program::Sym;
use smallvec::SmallVec;

use super::variables::BodyForm;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ImportPhase, NullishAccess};
use crate::ir::{FunctionKey, ModuleId, ValueId, VariableId, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::member::{PropertyName, Reference};
use crate::lower::scope::{BindingForm, BindingRef, Storage};
use crate::lower::{FileLowering, FunctionLowering, module};
use crate::modules::{Member, ModuleRef, Shape, Site, SyntheticExportId, View};

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn own_shape(&self) -> Shape {
        self.inputs.modules.shape(ModuleRef::File(self.file))
    }

    fn top_scope_of(&self, key: FunctionKey) -> Option<ScopeId> {
        let bound = self.bound;
        match key {
            FunctionKey::Source(source) => Some(bound.fns[source.function.idx()].scope),
            FunctionKey::ImplicitConstructor(class)
            | FunctionKey::InstanceInitializer(class)
            | FunctionKey::StaticInitializer(class) => Some(bound.class_scope[class.class.idx()]),
            FunctionKey::AccessorGetter { member, .. }
            | FunctionKey::AccessorSetter { member, .. }
            | FunctionKey::PrivateNameTest { member, .. } => bound
                .member_class(member)
                .map(|class| bound.class_scope[class.idx()]),
            _ => None,
        }
    }

    // The text of the module hands `module` to somebody, who can put an accessor in the place of `exports`: `Object.defineProperty(module, "exports", { get() { .. } })`.
    fn is_asked_of_module_object(&self, module: ModuleRef) -> bool {
        self.inputs.modules.commonjs().uses_module_object(module)
    }

    fn find_root(&self, access: ExprId) -> ExprId {
        let mut root = access;
        while let Some((object, _)) = self.hir.member_key(root) {
            root = self.skip_type_syntax(object);
        }
        root
    }

    fn find_holder(&self, name: ExprId) -> Option<(SymbolId, View)> {
        let ExprKind::Ident(_) = self.hir[name].kind else {
            return None;
        };
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        let view = self.inputs.modules.holder(self.file, symbol)?;
        Some((symbol, view))
    }

    fn inner_parameter(&self, callback: FnId, index: usize) -> Option<SymbolId> {
        let parameter = self.hir[callback].params.iter().nth(index)?;
        let pattern = self.hir[parameter].pat;
        let PatKind::Ident(_) = self.hir[pattern].kind else {
            return None;
        };
        Some(self.bound.declared_symbol(Decl::Param(pattern)))
    }

    /// `exports` and `module` of the callback of `__commonJS((exports, module) => { .. })`.
    pub(super) fn inner_parameters(&self, callback: FnId) -> [Option<SymbolId>; 2] {
        [
            self.inner_parameter(callback, 0),
            self.inner_parameter(callback, 1),
        ]
    }

    fn names_symbol(&self, name: ExprId, symbol: Option<SymbolId>) -> bool {
        matches!(self.hir[name].kind, ExprKind::Ident(_))
            && symbol.is_some_and(|symbol| self.bound.binding(name) == Binding::Symbol(symbol))
    }

    fn find_described_value(&self, descriptor: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptor)].kind else {
            return None;
        };
        let mut described = properties.iter().map(|property| hir[property]);
        let value = described.find(|property| property.key == PropKey::Name(known::value))?;
        matches!(value.kind, PropKind::Init | PropKind::Shorthand).then_some(value.value)
    }

    /// The module whose names the pattern takes, where `source` is a call of `require` that nobody reads as a value.
    pub(in crate::lower) fn find_destructured_module(&self, source: ExprId) -> Option<ModuleRef> {
        let call = self.skip_type_syntax(source);
        let ExprKind::Call(_) = self.hir[call].kind else {
            return None;
        };
        let modules = self.inputs.modules;
        match modules.site(self.file, call)? {
            Site::Evaluate { target, .. } if !modules.is_site_read_as_value(self.file, call) => {
                Some(target)
            }
            Site::Evaluate { .. } | Site::AsToday => None,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    /// The module that the code of the function belongs to: the file, or the inner module of a bundle that is written around it.
    pub(in crate::lower) fn current_module(&self) -> ModuleRef {
        let file = &*self.file;
        let modules = file.inputs.modules;
        let own_file = ModuleRef::File(file.file);
        if modules.inner_modules(file.file).is_empty() {
            return own_file;
        }
        let mut next = file.top_scope_of(self.key);
        while let Some(scope) = next {
            if let CodeUnit::Function(function) = file.bound.code_unit(scope)
                && let Some(inner) = modules.inner_module(file.file, function)
            {
                return inner;
            }
            next = file.bound.runtime_parent_scope(file.hir, scope).some();
        }
        own_file
    }

    pub(in crate::lower) fn current_module_id(&mut self) -> ModuleId {
        let module = self.current_module();
        self.file.fragment.declare_module(module)
    }

    /// `return e` there ends the evaluation of a CommonJS module, and nobody gets `e`.
    pub(in crate::lower) fn drops_returned_value(&self) -> bool {
        match self.key {
            FunctionKey::ModuleBody(_) => self.file.body_form() == BodyForm::Plain,
            _ => self.is_module_body(),
        }
    }

    pub(in crate::lower) fn is_module_body(&self) -> bool {
        let file = &*self.file;
        match self.key {
            FunctionKey::ModuleBody(_) => true,
            FunctionKey::Source(source) => file
                .inputs
                .modules
                .inner_module(file.file, source.function)
                .is_some(),
            _ => false,
        }
    }

    pub(super) fn get_own_exports(&mut self) -> ValueId {
        let own_file = ModuleRef::File(self.file.file);
        let variable = ensure_exports_variable(self.file, own_file);
        let variable = variable.expect("a file has a variable for its exports");
        self.builder.get_module_variable(variable)
    }

    fn emit_checked_read(&mut self, key: VariableKey, name: Atom) -> ValueId {
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        let name = self.file.intern_atom(name);
        self.builder.check_initialized(value, name)
    }

    /// What an ES module gets under a name that it imports from a CommonJS module. `None`: the module does not have the name.
    pub(in crate::lower) fn read_imported_name(
        &mut self,
        module: ModuleRef,
        name: Atom,
    ) -> Option<ValueId> {
        // The default of a module without the marker is what `module.exports` holds.
        if name == known::default && self.file.inputs.modules.marker(module) != Some(true) {
            return emit_module_value(self, module);
        }
        self.read_named_export(module, name)
    }

    /// What `require` of a module has under a name that no member access spells: a key of a pattern.
    pub(in crate::lower) fn read_named_export(
        &mut self,
        module: ModuleRef,
        name: Atom,
    ) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        let member = match modules.member_named(module, name) {
            Some(Member::Undefined) => return None,
            Some(member) => member,
            None => {
                let binding = modules.binding_of_member_named(module, name)?;
                let name = self.file.intern_atom(name);
                return Some(module::emit_import_binding(self, binding, name));
            }
        };
        if let Some(value) = emit_member_read(self, member) {
            return Some(value);
        }
        let object = emit_module_value(self, module)?;
        let key = self.file.name_key(name);
        Some(self.emit_get(object, PropertyName::Constant(key)))
    }

    // A closure that is made behind the initializer takes nothing of the holder along, and has nothing to test.
    fn is_stored_for(&self, holder: SymbolId) -> bool {
        let binding = BindingRef::Symbol(holder);
        if self.scopes.find_local(binding).is_some() {
            return true;
        }
        let captures = self.file.scopes.captures(self.key);
        if captures.binary_search(&Capture::Value(binding)).is_ok() {
            return true;
        }
        match self
            .file
            .scopes
            .placement(binding)
            .map(|placement| placement.storage)
        {
            Some(Storage::Field { .. } | Storage::Variable(_)) => true,
            Some(Storage::Local) | None => false,
        }
    }

    // What stands in front of the first dot does what it always did: a name may be in its dead zone, and a call of `require` evaluates the module.
    fn lower_root(&mut self, access: ExprId) -> Option<ValueId> {
        let hir = self.file.hir;
        let root = self.file.find_root(access);
        if let ExprKind::Call(_) = hir[root].kind {
            self.lower_expression_for_effect(root);
            return None;
        }
        let ExprKind::Ident(_) = hir[root].kind else {
            return None;
        };
        let Binding::Symbol(holder) = self.file.bound.binding(root) else {
            return None;
        };
        let is_read = match self.file.find_holder(root) {
            Some(_) => self.is_stored_for(holder),
            // A name that holds the one value of a module, whose members are variables all the same.
            None => {
                self.file.scopes.form(holder) == BindingForm::Stored
                    && !self.is_inner_parameter(holder)
            }
        };
        if !is_read {
            return None;
        }
        self.set_position(hir[root].pos);
        let held = self.lower_identifier(root);
        match self.file.bound.initial_state(holder) {
            InitialState::Undefined => Some(held),
            InitialState::Uninitialized | InitialState::Initialized => None,
        }
    }

    pub(in crate::lower) fn test_holder(&mut self, holder: Option<ValueId>, access: NullishAccess) {
        if let Some(holder) = holder {
            self.builder.require_object_coercible(holder, access, None);
        }
    }

    /// What stands in front of a member that is bound to a variable is evaluated as it always was.
    pub(in crate::lower) fn check_member_root(&mut self, access: ExprId) {
        let holder = self.lower_root(access);
        self.test_holder(holder, NullishAccess::Read);
    }

    pub(in crate::lower) fn lower_export_member(&mut self, access: ExprId) -> Option<ValueId> {
        let member = find_bound_member(self.file, access)?;
        let position = self.file.hir[access].pos;
        let holder = self.lower_root(access);
        self.set_position(position);
        self.test_holder(holder, NullishAccess::Read);
        emit_member_read(self, member)
    }

    // The module whose exports stand in front of the last dot of `R.N(..)`.
    fn find_receiver_view(&self, access: ExprId) -> Option<View> {
        let file = &*self.file;
        let (object, _) = file.hir.member_key(access)?;
        let object = file.skip_type_syntax(object);
        if let Some((_, view)) = file.find_holder(object) {
            return Some(view);
        }
        if let ExprKind::Call(_) = file.hir[object].kind {
            return match file.inputs.modules.site(file.file, object)? {
                Site::Evaluate { target, .. } => Some(match file.inputs.modules.shape(target) {
                    Shape::EsModule => View::Namespace(target),
                    Shape::Names | Shape::Value | Shape::AsToday => View::Exports(target),
                }),
                Site::AsToday => None,
            };
        }
        self.find_exports_mention(object).map(View::Exports)
    }

    /// `this` of a call of a bound member. A module without an object has only functions that do not look at it.
    pub(in crate::lower) fn lower_export_receiver(&mut self, access: ExprId) -> ValueId {
        let receiver = match self.find_receiver_view(access) {
            Some(View::Namespace(module)) if self.file.inputs.modules.is_left_out(module) => None,
            Some(View::Namespace(module)) => {
                let module = self.file.fragment.declare_module(module);
                Some(
                    self.builder
                        .module_namespace(module, ImportPhase::Evaluation),
                )
            }
            Some(View::Exports(module)) => emit_module_value(self, module),
            None => None,
        };
        receiver.unwrap_or_else(|| self.builder.undefined())
    }

    fn is_inner_parameter(&self, symbol: SymbolId) -> bool {
        match self.current_module() {
            ModuleRef::Inner { callback, .. } => {
                self.file.inner_parameters(callback).contains(&Some(symbol))
            }
            _ => false,
        }
    }

    // `module.exports`, as it is written, of the module that the code belongs to.
    fn find_module_exports_access(&self, access: ExprId) -> Option<ModuleRef> {
        let file = &*self.file;
        let (object, key) = file.hir.member_key(access)?;
        if key != MemberKey::Name(known::exports) {
            return None;
        }
        match self.current_module() {
            module @ ModuleRef::Inner { callback, .. } => {
                let object = file.skip_type_syntax(object);
                file.names_symbol(object, file.inner_parameter(callback, 1))
                    .then_some(module)
            }
            module @ ModuleRef::File(_) => {
                let is_own = file.body_form() == BodyForm::Plain
                    && file.builtins.builtin_of_expression(access)
                        == Some(BuiltinId::ModuleObjectExports);
                is_own.then_some(module)
            }
            _ => None,
        }
    }

    // `exports`, `module.exports` or `this` at the top of the module that the code belongs to.
    fn find_exports_mention(&self, expression: ExprId) -> Option<ModuleRef> {
        let file = &*self.file;
        if let Some(module) = self.find_module_exports_access(expression) {
            return Some(module);
        }
        let module = self.current_module();
        let is_mention = match (module, file.hir[expression].kind) {
            (ModuleRef::Inner { callback, .. }, ExprKind::Ident(_)) => {
                file.names_symbol(expression, file.inner_parameter(callback, 0))
            }
            // The table of built-ins also follows a stable `var u = exports`. It says nothing of a name that is stored to.
            (ModuleRef::File(_), ExprKind::Ident(_)) => {
                let names_exports = file.bound.binding(expression)
                    == Binding::CommonJs(CommonJsVariable::Exports)
                    || file.builtins.builtin_of_expression(expression)
                        == Some(BuiltinId::ModuleObjectExports);
                file.body_form() == BodyForm::Plain && names_exports
            }
            (ModuleRef::File(_), ExprKind::This) => {
                file.body_form() == BodyForm::Plain && self.is_this_of_module()
            }
            _ => false,
        };
        is_mention.then_some(module)
    }

    /// A read of `module.exports` is a read of the variable, and of one of the five names what the name stands for.
    pub(in crate::lower) fn try_lower_mention(&mut self, expression: ExprId) -> Option<ValueId> {
        if let Some(value) = self.try_lower_module_field(expression) {
            return Some(value);
        }
        if let Some(module) = self.find_module_exports_access(expression) {
            let value = emit_module_value(self, module);
            // Only whether it is an object can be asked of it.
            return Some(value.unwrap_or_else(|| self.builder.boolean(true)));
        }
        let file = &*self.file;
        if file.body_form() != BodyForm::Plain {
            return None;
        }
        let ExprKind::Ident(_) = file.hir[expression].kind else {
            return None;
        };
        match file.bound.binding(expression) {
            Binding::CommonJs(variable) => {
                Some(self.get_variable(variable, super::ReadPurpose::Value))
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => None,
        }
    }

    /// `module.exports = value` stores the variable. Where the module has no object, the statement that stores is lowered as a whole.
    pub(super) fn lower_module_exports_reference(&mut self, access: ExprId) -> Option<Reference> {
        let module = self.find_module_exports_access(access)?;
        if self.file.is_asked_of_module_object(module) {
            return None;
        }
        Some(match self.file.inputs.modules.shape(module) {
            Shape::Value | Shape::AsToday => Reference::ModuleVariable {
                variable: ensure_exports_variable(self.file, module)?,
                holder: None,
            },
            Shape::Names | Shape::EsModule => Reference::Discarded { holder: None },
        })
    }

    /// `delete module.exports`: from then on `module.exports` reads `undefined`, and so does whoever requires the module.
    pub(in crate::lower) fn try_lower_exports_deletion(
        &mut self,
        access: ExprId,
    ) -> Option<ValueId> {
        let module = self.find_module_exports_access(access)?;
        if self.file.is_asked_of_module_object(module) {
            return None;
        }
        let variable = match self.file.inputs.modules.shape(module) {
            Shape::Value | Shape::AsToday => ensure_exports_variable(self.file, module)?,
            Shape::Names | Shape::EsModule => return None,
        };
        let undefined = self.builder.undefined();
        self.builder.put_module_variable(variable, undefined);
        Some(self.builder.boolean(true))
    }

    /// `Object.defineProperty(exports, "n", { value: v })` where `n` is a variable, and the definition of the marker.
    pub(in crate::lower) fn try_lower_export_definition(
        &mut self,
        call: ExprId,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let member = find_bound_member(self.file, call)?;
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let arguments = hir[site].args;
        if arguments.len() != 3 {
            return None;
        }
        let described = self.file.find_described_value(hir.id_at(arguments, 2));
        match (member, described) {
            (Member::Variable(export), Some(described)) => {
                let value = self.lower_expression(described);
                self.set_position(hir[call].pos);
                let key = VariableKey::SyntheticExport(export);
                let variable = self.file.ensure_variable(key);
                self.builder.put_module_variable(variable, value);
            }
            (Member::Undefined | Member::Marker(_), Some(described)) => {
                self.lower_expression_for_effect(described);
            }
            (Member::Undefined | Member::Marker(_), None) => {}
            (Member::Variable(_) | Member::Copy(_) | Member::Binding(_) | Member::OnObject, _) => {
                return None;
            }
        }
        // The call answers the object, which nobody looks at.
        Some(self.builder.boolean(true))
    }

    // `module.exports = value` and `exports = module.exports = value`: the module and the value.
    fn find_exports_store(&self, expression: ExprId) -> Option<(ModuleRef, ExprId)> {
        let file = &*self.file;
        let (target, value) = find_plain_store(file, expression)?;
        if let Some(module) = self.find_module_exports_access(target) {
            return Some((module, value));
        }
        let (inner_target, inner_value) = find_plain_store(file, value)?;
        let module = self.find_module_exports_access(inner_target)?;
        let names_exports = matches!(file.hir[target].kind, ExprKind::Ident(_))
            && self.find_exports_mention(target) == Some(module);
        names_exports.then_some((module, inner_value))
    }

    // `module.exports = { a, b: v, c() {} }`: all values, then the stores. A name that nobody reads has no variable.
    fn lower_exported_literal(&mut self, module: ModuleRef, literal: ExprId) -> bool {
        let hir = self.file.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let has_plain_keys = properties.iter().all(|property| {
            matches!(hir.runtime_property_key(property), PropKey::Name(_))
                && matches!(
                    hir[property].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                )
        });
        if !has_plain_keys {
            return false;
        }
        let mut stores: SmallVec<[(SyntheticExportId, ValueId); 8]> = SmallVec::new();
        for id in properties.iter() {
            let property = hir[id];
            let PropKey::Name(name) = hir.runtime_property_key(id) else {
                unreachable!("every key of the literal is a name");
            };
            self.set_position(property.pos);
            let member = self.file.inputs.modules.member_named(module, name);
            let Some(Member::Variable(export)) = member else {
                if property.kind != PropKind::Method {
                    self.lower_expression_for_effect(property.value);
                }
                continue;
            };
            let key = PropertyName::Constant(self.file.name_key(name));
            let value = match (property.kind, hir[property.value].kind) {
                // A method that uses `super` needs the object, so the module would have one.
                (PropKind::Method, ExprKind::Fn(method)) => {
                    self.lower_function_expression(method, Some(key))
                }
                _ => self.lower_named_evaluation(property.value, key),
            };
            stores.retain(|store| store.0 != export);
            stores.push((export, value));
        }
        self.set_position(hir[literal].pos);
        for (export, value) in stores {
            let key = VariableKey::SyntheticExport(export);
            let variable = self.file.ensure_variable(key);
            self.builder.put_module_variable(variable, value);
        }
        true
    }

    /// A statement that stores `module.exports` of a module without an object: a literal gives each of its names its value.
    pub(in crate::lower) fn try_lower_exports_statement(&mut self, expression: ExprId) -> bool {
        let Some((module, value)) = self.find_exports_store(expression) else {
            return false;
        };
        let value = self.file.skip_type_syntax(value);
        match self.file.inputs.modules.shape(module) {
            Shape::Names => self.lower_exported_literal(module, value),
            Shape::Value | Shape::EsModule | Shape::AsToday => false,
        }
    }

    /// `export = value` of TypeScript is `module.exports = value` as a statement.
    pub(in crate::lower) fn try_lower_export_assignment(&mut self, value: ExprId) -> bool {
        let module = ModuleRef::File(self.file.file);
        let value = self.file.skip_type_syntax(value);
        match self.file.inputs.modules.shape(module) {
            Shape::Names => self.lower_exported_literal(module, value),
            Shape::Value | Shape::EsModule | Shape::AsToday => false,
        }
    }
}

/// The variable that holds `module.exports` of a module whose exports are one value.
pub(super) fn ensure_exports_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<VariableId> {
    let key = match module {
        ModuleRef::File(file) => VariableKey::ModuleExports(file),
        ModuleRef::Inner { file, callback } => VariableKey::InnerModuleExports(FunctionRef {
            file,
            function: callback,
        }),
        _ => return None,
    };
    Some(file.ensure_variable(key))
}

/// What `require` of an evaluated module answers. `None`: the module has no object, and nobody asks for one.
pub(in crate::lower) fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<ValueId> {
    match lowering.file.inputs.modules.shape(module) {
        // `init_x()` of a bundle answers nothing: what the module exports are bindings of the file.
        Shape::EsModule if matches!(module, ModuleRef::Inner { .. }) => {
            Some(lowering.builder.undefined())
        }
        Shape::EsModule => {
            let module = lowering.file.fragment.declare_module(module);
            Some(
                lowering
                    .builder
                    .module_namespace(module, ImportPhase::Evaluation),
            )
        }
        Shape::Value | Shape::AsToday if lowering.file.is_asked_of_module_object(module) => {
            let module = lowering.file.fragment.declare_module(module);
            let object = lowering
                .builder
                .module_builtin(BuiltinId::ModuleObject, module);
            let key = lowering.file.name_key(known::exports);
            Some(lowering.emit_get(object, PropertyName::Constant(key)))
        }
        Shape::Value | Shape::AsToday => {
            let variable = ensure_exports_variable(lowering.file, module)?;
            Some(lowering.builder.get_module_variable(variable))
        }
        Shape::Names => None,
    }
}

fn symbol_name(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> Atom {
    file.queries
        .files()
        .bound(symbol.file)
        .symbol(symbol.id)
        .name
}

fn export_name(file: &FileLowering<'_, '_, '_, '_>, export: SyntheticExportId) -> Atom {
    file.inputs.modules.synthetic_export(export).name
}

// `None`: the member is a property of an object.
fn emit_member_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: Member,
) -> Option<ValueId> {
    Some(match member {
        Member::Variable(export) => {
            let key = VariableKey::SyntheticExport(export);
            let variable = lowering.file.ensure_variable(key);
            lowering.builder.get_module_variable(variable)
        }
        Member::Copy(export) => {
            let name = export_name(lowering.file, export);
            lowering.emit_checked_read(VariableKey::Copy(export), name)
        }
        Member::Binding(symbol) if symbol.file == lowering.file.file => {
            let name = symbol_name(lowering.file, symbol);
            lowering.get_binding(Binding::Symbol(symbol.id), name)
        }
        Member::Binding(symbol) => {
            let name = symbol_name(lowering.file, symbol);
            lowering.emit_checked_read(VariableKey::Symbol(symbol), name)
        }
        Member::Undefined | Member::Marker(false) => lowering.builder.undefined(),
        Member::Marker(true) => lowering.builder.boolean(true),
        Member::OnObject => return None,
    })
}

fn find_bound_member(file: &FileLowering<'_, '_, '_, '_>, access: ExprId) -> Option<Member> {
    match file.inputs.modules.member(file.file, access)? {
        Member::OnObject => None,
        member => Some(member),
    }
}

pub(super) fn lower_export_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<Reference> {
    let member = find_bound_member(lowering.file, access)?;
    let holder = lowering.lower_root(access);
    Some(match member {
        Member::Variable(export) => Reference::ModuleVariable {
            variable: lowering
                .file
                .ensure_variable(VariableKey::SyntheticExport(export)),
            holder,
        },
        // `exports.__esModule = true`, and `exports.n = void 0` in front of what makes `n` stand for another variable.
        Member::Undefined | Member::Marker(_) => Reference::Discarded { holder },
        Member::Copy(_) | Member::Binding(_) => {
            debug_assert!(
                false,
                "no store is bound to a copy or to a binding of the module"
            );
            Reference::Discarded { holder }
        }
        Member::OnObject => unreachable!("find_bound_member leaves it to the object"),
    })
}

fn find_plain_store(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<(ExprId, ExprId)> {
    let expression = file.skip_type_syntax(expression);
    match file.hir[expression].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => Some((file.skip_type_syntax(target), value)),
        _ => None,
    }
}

/// The statement is `var require_x = __commonJS(..)` or another one that the graph of modules has taken all there is from.
pub(in crate::lower) fn is_erased(file: &FileLowering<'_, '_, '_, '_>, statement: StmtId) -> bool {
    file.inputs.modules.erased(file.file, statement)
}
