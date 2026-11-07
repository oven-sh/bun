use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CodeUnit, CommonJsVariable, Decl, InitialState, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ExprId, ExprKind, FnId, MemberKey, PatKind, PropKey, PropKind, StmtId};
use smallvec::SmallVec;

use super::variables::BodyForm;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::NullishAccess;
use crate::ir::{FunctionKey, ModuleId, TypeTable, ValueId, VariableId, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::member::{Holder, PropertyName, Reference};
use crate::lower::scope::{BindingForm, BindingRef, Storage};
use crate::lower::{FileLowering, FunctionLowering, member, module};
use crate::modules::{
    DescribedPart, ImportBinding, Member, ModuleRef, Shape, Site, SyntheticExportId, View,
    WrittenDescriptor, find_literal_exported_under_name,
};

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn ensure_exports_variable(&mut self, module: ModuleRef) -> Option<VariableId> {
        let key = match module {
            ModuleRef::File(file) => VariableKey::ModuleExports(file),
            ModuleRef::Inner { file, callback } => VariableKey::InnerModuleExports(FunctionRef {
                file,
                function: callback,
            }),
            _ => return None,
        };
        Some(self.ensure_variable(key))
    }

    pub(super) fn ensure_whole_exports_variable(
        &mut self,
        module: ModuleRef,
    ) -> Option<VariableId> {
        match self.inputs.modules.shape(module) {
            Shape::Value | Shape::AsToday => self.ensure_exports_variable(module),
            Shape::EsModule | Shape::Names => None,
        }
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

    fn reads_exports_from_module_object(&self, module: ModuleRef) -> bool {
        self.inputs.modules.commonjs().uses_module_object(module)
    }

    pub(in crate::lower) fn find_view(&self, expression: ExprId) -> Option<View> {
        let modules = self.inputs.modules;
        match self.hir[expression].kind {
            ExprKind::Ident(_) => match self.bound.binding(expression) {
                Binding::Symbol(symbol) => modules.holder(self.file, symbol),
                Binding::CommonJs(_) | Binding::Arguments(_) | Binding::Free => None,
            },
            ExprKind::Call(_) => match modules.site(self.file, expression)? {
                Site::Evaluate { target, .. } => Some(match modules.shape(target) {
                    Shape::EsModule => View::Namespace(target),
                    Shape::Names | Shape::Value | Shape::AsToday => View::Exports(target),
                }),
                Site::AsToday => None,
            },
            _ => None,
        }
    }

    fn inner_parameter(&self, callback: FnId, index: usize) -> Option<SymbolId> {
        let parameter = self.hir[callback].params.iter().nth(index)?;
        let pattern = self.hir[parameter].pat;
        let PatKind::Ident(_) = self.hir[pattern].kind else {
            return None;
        };
        Some(self.bound.declared_symbol(Decl::Param(pattern)))
    }

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
        let written = WrittenDescriptor::read(self.hir, self.decisions(), descriptor)?;
        match written.part {
            DescribedPart::Data { value, .. } => value,
            DescribedPart::Accessor { .. } => None,
        }
    }

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
        let variable = self.file.ensure_exports_variable(own_file);
        let variable = variable.expect("a file has a variable for its exports");
        self.builder.get_module_variable(variable)
    }

    pub(in crate::lower) fn read_imported_name(
        &mut self,
        module: ModuleRef,
        name: Atom,
    ) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        if name == known::default && modules.marker_for_imports(module) != Some(true) {
            return emit_module_value(self, module);
        }
        self.read_named_export(module, name)
    }

    pub(in crate::lower) fn read_name_at_link(
        &mut self,
        module: ModuleRef,
        name: Atom,
    ) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        let is_module_value = name == known::default && modules.marker(module) != Some(true);
        let returned = modules.commonjs().member_behind_getter(module, name);
        let Some(Member::Binding(symbol)) = returned.filter(|_| !is_module_value) else {
            return self.read_imported_name(module, name);
        };
        let value = if symbol.file == self.file.file {
            self.get_stored(BindingRef::Symbol(symbol.id))
        } else {
            let variable = self.file.ensure_variable(VariableKey::Symbol(symbol));
            self.builder.get_module_variable(variable)
        };
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        let undefined = self.builder.undefined();
        self.builder.write_variable(result, undefined);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.continue_in(join);
        Some(self.builder.read_variable(result))
    }

    pub(in crate::lower) fn read_named_export(
        &mut self,
        module: ModuleRef,
        name: Atom,
    ) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        let member = match modules.member_named(module, name) {
            Some(Member::Undefined) => return None,
            Some(Member::Binding(symbol))
                if symbol.file != self.file.file
                    && matches!(module, ModuleRef::File(file) if modules.reaches_mock(file)) =>
            {
                let files = self.file.queries.files();
                let declared = files.bound(symbol.file).symbol(symbol.id).name;
                let declared = self.file.intern_atom(declared);
                let asked = match module {
                    ModuleRef::File(file) => Some((file, name)),
                    _ => None,
                };
                let binding = ImportBinding::Variable(symbol);
                return Some(module::emit_import_binding_asked(
                    self, binding, declared, asked,
                ));
            }
            Some(member) => member,
            None => {
                let binding = modules.binding_of_member_named(module, name)?;
                let asked = match module {
                    ModuleRef::File(file) => Some((file, name)),
                    _ => None,
                };
                let name = self.file.intern_atom(name);
                return Some(module::emit_import_binding_asked(
                    self, binding, name, asked,
                ));
            }
        };
        if let Some(value) = emit_member_read(self, member) {
            return Some(value);
        }
        let object = emit_module_value(self, module)?;
        Some(self.emit_named_read(object, name))
    }

    fn is_stored_for(&self, holder: SymbolId) -> bool {
        let binding = BindingRef::Symbol(holder);
        if self.scopes.find_local(binding).is_some() {
            return true;
        }
        let captures = self.file.scopes.captures(self.key);
        if captures.binary_search(&Capture::Value(binding)).is_ok() {
            return true;
        }
        let placement = self.file.scopes.placement(binding);
        match placement.map(|placement| placement.storage) {
            Some(Storage::Field { .. } | Storage::Variable(_)) => true,
            Some(Storage::Local) | None => false,
        }
    }

    fn lower_root(&mut self, access: ExprId) -> Option<Holder> {
        let hir = self.file.hir;
        let mut root = access;
        let mut first_key = None;
        while let Some((object, key)) = hir.member_key(root) {
            root = self.file.skip_type_syntax(object);
            first_key = Some(key);
        }
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
        let is_read = match self.file.inputs.modules.holder(self.file.file, holder) {
            Some(_) => self.is_stored_for(holder),
            None => {
                self.file.scopes.form(holder) == BindingForm::Stored
                    && !self.is_inner_parameter(holder)
            }
        };
        if !is_read {
            return None;
        }
        self.set_position(hir[root].pos);
        let value = self.lower_identifier(root);
        match self.file.bound.initial_state(holder) {
            InitialState::Undefined => {
                let member = match first_key {
                    Some(MemberKey::Name(name)) => Some(self.file.intern_atom(name)),
                    _ => None,
                };
                Some(Holder { value, member })
            }
            InitialState::Uninitialized | InitialState::Initialized => None,
        }
    }

    pub(in crate::lower) fn test_holder(&mut self, holder: Option<Holder>, access: NullishAccess) {
        if let Some(Holder { value, member }) = holder {
            self.builder.require_object_coercible(value, access, member);
        }
    }

    pub(in crate::lower) fn check_member_root(&mut self, access: ExprId) {
        let holder = self.lower_root(access);
        self.test_holder(holder, NullishAccess::Read);
    }

    pub(in crate::lower) fn lower_export_member(&mut self, access: ExprId) -> Option<ValueId> {
        let member = self.file.inputs.modules.member(self.file.file, access)?;
        let namespace = match (member, self.find_receiver_view(access)) {
            (Member::OnObject, Some(View::Namespace(module))) => Some(module),
            (Member::OnObject, Some(View::Exports(_)) | None) => return None,
            _ => None,
        };
        let position = self.file.hir[access].pos;
        let holder = self.lower_root(access);
        let Some(module) = namespace else {
            self.set_position(position);
            self.test_holder(holder, NullishAccess::Read);
            return emit_member_read(self, member);
        };
        self.test_holder(holder, NullishAccess::Read);
        let (_, key) = self.file.hir.member_key(access)?;
        let object = self.emit_evaluated_namespace(module);
        let name = self.lower_member_key(key);
        Some(member::emit_member_read(self, access, object, name))
    }

    fn emit_evaluated_namespace(&mut self, module: ModuleRef) -> ValueId {
        self.emit_namespace_asked_by_name(module)
    }

    fn find_receiver_view(&self, access: ExprId) -> Option<View> {
        let file = &*self.file;
        let (object, _) = file.hir.member_key(access)?;
        let object = file.skip_type_syntax(object);
        let view = file.find_view(object);
        view.or_else(|| self.find_exports_mention(object).map(View::Exports))
    }

    pub(in crate::lower) fn lower_export_receiver(&mut self, access: ExprId) -> ValueId {
        let receiver = match self.find_receiver_view(access) {
            Some(View::Namespace(module)) if self.file.inputs.modules.is_left_out(module) => None,
            Some(View::Namespace(module)) => Some(self.emit_evaluated_namespace(module)),
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

    fn find_module_exports_access(&self, access: ExprId) -> Option<ModuleRef> {
        let file = &*self.file;
        let (object, key) = file.hir.member_key(access)?;
        let is_named_exports = key == MemberKey::Name(known::exports);
        let is_in_plain_body = file.body_form() == BodyForm::Plain;
        if !is_named_exports && !is_in_plain_body {
            return None;
        }
        match self.current_module() {
            module @ ModuleRef::Inner { callback, .. } => {
                let object = file.skip_type_syntax(object);
                let names_exports = is_named_exports
                    && file.names_symbol(object, file.inner_parameter(callback, 1));
                names_exports.then_some(module)
            }
            module @ ModuleRef::File(_) => {
                let is_own = is_in_plain_body
                    && !self.is_function_of_file_that_runs_again()
                    && matches!(
                        file.builtins.of_pure_expr(access),
                        Some(Resolved::Builtin(path)) if path.id == BuiltinId::ModuleObjectExports
                    );
                is_own.then_some(module)
            }
            _ => None,
        }
    }

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

    pub(in crate::lower) fn try_lower_mention(&mut self, expression: ExprId) -> Option<ValueId> {
        if let Some(value) = self.try_lower_module_field(expression) {
            return Some(value);
        }
        let kind = self.file.hir.exprs.get(expression.idx())?.kind;
        if matches!(kind, ExprKind::Dot { .. } | ExprKind::Index { .. })
            && let Some(module) = self.find_module_exports_access(expression)
        {
            let value = emit_module_value(self, module);
            return Some(value.unwrap_or_else(|| self.builder.boolean(true)));
        }
        let file = &*self.file;
        if !matches!(kind, ExprKind::Ident(_)) || file.body_form() != BodyForm::Plain {
            return None;
        }
        match file.bound.binding(expression) {
            Binding::CommonJs(variable) => Some(self.get_commonjs_variable(variable)),
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => None,
        }
    }

    fn lower_module_exports_reference(&mut self, access: ExprId) -> Option<Reference> {
        let module = self.find_module_exports_access(access)?;
        if self.file.reads_exports_from_module_object(module) {
            return None;
        }
        let holder = None;
        Some(match self.file.ensure_whole_exports_variable(module) {
            Some(variable) => Reference::ModuleVariable { variable, holder },
            None => Reference::Discarded { holder },
        })
    }

    pub(in crate::lower) fn try_lower_exports_deletion(
        &mut self,
        access: ExprId,
    ) -> Option<ValueId> {
        let module = self.find_module_exports_access(access)?;
        if self.file.reads_exports_from_module_object(module) {
            return None;
        }
        let variable = self.file.ensure_whole_exports_variable(module)?;
        let undefined = self.builder.undefined();
        self.builder.put_module_variable(variable, undefined);
        Some(self.builder.boolean(true))
    }

    pub(in crate::lower) fn try_lower_export_definition(
        &mut self,
        call: ExprId,
    ) -> Option<ValueId> {
        let hir = self.file.hir;

        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let arguments = hir[site].args;
        if arguments.len() != 3 {
            return None;
        }
        let member = find_bound_member(self.file, call)?;
        let described = self.file.find_described_value(hir.id_at(arguments, 2));
        let is_lowered_here = matches!(
            (member, described),
            (Member::Variable(_), Some(_)) | (Member::Undefined | Member::Marker(_), _)
        );
        if is_lowered_here {
            let callee = self.file.skip_type_syntax(hir[site].callee);
            self.lower_read_of_locked_path(callee);
        }
        match (member, described) {
            (Member::Variable(export), Some(described)) => {
                let key = PropertyName::Constant(self.file.name_key(known::value));
                let value = self.lower_named_evaluation(described, key);
                self.set_position(hir[call].pos);
                let key = VariableKey::SyntheticExport(export);
                let variable = self.file.ensure_variable(key);
                self.builder.put_module_variable(variable, value);
            }
            (Member::Undefined | Member::Marker(_), Some(described)) => {
                self.lower_unread_value(described, known::value);
            }
            (Member::Undefined | Member::Marker(_), None) => {}
            (Member::Variable(_) | Member::Copy(_) | Member::Binding(_) | Member::OnObject, _) => {
                return None;
            }
        }
        Some(self.builder.boolean(true))
    }

    fn lower_unread_value(&mut self, value: ExprId, key: Atom) {
        match self.file.hir[self.file.skip_type_syntax(value)].kind {
            ExprKind::Class(_) if !self.file.decisions().is_truthy_without_effects(value) => {
                let key = PropertyName::Constant(self.file.name_key(key));
                self.lower_named_evaluation(value, key);
            }
            _ => self.lower_taken_value_for_effect(value),
        }
    }

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

    pub(in crate::lower) fn try_lower_export_assignment(&mut self, literal: ExprId) -> bool {
        self.try_lower_exported_literal(ModuleRef::File(self.file.file), literal)
    }

    fn try_lower_exported_literal(&mut self, module: ModuleRef, literal: ExprId) -> bool {
        let hir = self.file.hir;
        match self.file.inputs.modules.shape(module) {
            Shape::Names => {}
            Shape::Value | Shape::EsModule | Shape::AsToday => return false,
        }
        let literal = self.file.skip_type_syntax(literal);
        let named = find_literal_exported_under_name(hir, self.file.bound, literal);
        let literal = named.map_or(literal, |(written, _)| written);
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
                    self.lower_unread_value(property.value, name);
                }
                continue;
            };
            let key = PropertyName::Constant(self.file.name_key(name));
            let value = match (property.kind, hir[property.value].kind) {
                (PropKind::Method, ExprKind::Fn(method)) => {
                    self.lower_function_expression(method, Some(key.into()))
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

    pub(in crate::lower) fn try_lower_exports_statement(&mut self, expression: ExprId) -> bool {
        let store = self.find_exports_store(expression);
        store.is_some_and(|(module, value)| self.try_lower_exported_literal(module, value))
    }
}

pub(in crate::lower) fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<ValueId> {
    match lowering.file.inputs.modules.shape(module) {
        Shape::EsModule if matches!(module, ModuleRef::Inner { .. }) => {
            Some(lowering.builder.undefined())
        }
        Shape::EsModule => Some(lowering.emit_evaluated_namespace(module)),
        Shape::Value | Shape::AsToday if lowering.file.reads_exports_from_module_object(module) => {
            let module = lowering.file.fragment.declare_module(module);
            let object = lowering
                .builder
                .module_builtin(BuiltinId::ModuleObject, module);
            Some(lowering.emit_named_read(object, known::exports))
        }
        Shape::Value | Shape::AsToday => {
            let variable = lowering.file.ensure_exports_variable(module)?;
            Some(lowering.builder.get_module_variable(variable))
        }
        Shape::Names => None,
    }
}

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
            let name = lowering.file.inputs.modules.synthetic_export(export).name;
            let name = lowering.file.intern_atom(name);
            lowering.emit_variable_read(VariableKey::Copy(export), name)
        }
        Member::Binding(symbol) => {
            let files = lowering.file.queries.files();
            let name = files.bound(symbol.file).symbol(symbol.id).name;
            if symbol.file == lowering.file.file {
                lowering.get_binding(Binding::Symbol(symbol.id), name)
            } else {
                let name = lowering.file.intern_atom(name);
                lowering.emit_variable_read(VariableKey::Symbol(symbol), name)
            }
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

pub(in crate::lower) fn lower_export_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<Reference> {
    let Some(member) = find_bound_member(lowering.file, access) else {
        return lowering.lower_module_exports_reference(access);
    };
    let holder = lowering.lower_root(access);
    Some(match member {
        Member::Variable(export) => {
            let key = VariableKey::SyntheticExport(export);
            let variable = lowering.file.ensure_variable(key);
            Reference::ModuleVariable { variable, holder }
        }
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

#[inline]
pub(in crate::lower) fn is_erased(file: &FileLowering<'_, '_, '_, '_>, statement: StmtId) -> bool {
    let modules = file.inputs.modules;
    modules.erased(file.file, statement)
        || (modules.commonjs()).is_evaluated_at_store(file.file, statement)
}
