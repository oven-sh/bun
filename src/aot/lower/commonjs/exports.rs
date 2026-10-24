use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CommonJsVariable, InitialState, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, MemberKey, PropKey, PropKind, StmtId};
use smallvec::SmallVec;

use super::variables::BodyForm;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ImportPhase, NullishAccess};
use crate::ir::{FunctionKey, ValueId, VariableId, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::member::{PropertyName, Reference};
use crate::lower::scope::{BindingForm, BindingRef, Storage};
use crate::lower::{FileLowering, FunctionLowering, module};
use crate::modules::{Member, ModuleRef, Shape, Site, SyntheticExportId, View};

impl FileLowering<'_, '_, '_, '_> {
    /// The variable that holds `module.exports` of a module whose exports are one value.
    pub(super) fn ensure_exports_variable(&mut self, module: ModuleRef) -> Option<VariableId> {
        let ModuleRef::File(exporter) = module else {
            return None;
        };
        Some(self.ensure_variable(VariableKey::ModuleExports(exporter)))
    }

    /// The same of the file itself. `None`: its exports are not one value.
    pub(super) fn ensure_own_exports_variable(&mut self) -> Option<VariableId> {
        let own_module = ModuleRef::File(self.file);
        match self.inputs.modules.shape(own_module) {
            Shape::Value | Shape::AsToday => self.ensure_exports_variable(own_module),
            Shape::EsModule | Shape::Names => None,
        }
    }

    // The text of the module hands `module` to somebody, who can put an accessor in the place of `exports`: `Object.defineProperty(module, "exports", { get() { .. } })`.
    fn is_asked_of_module_object(&self, module: ModuleRef) -> bool {
        self.inputs.modules.commonjs().uses_module_object(module)
    }

    /// The module that a name holds, or that a call of `require` evaluates where it stands.
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
    /// `return e` there ends the evaluation of a CommonJS module, and nobody gets `e`.
    pub(in crate::lower) fn drops_returned_value(&self) -> bool {
        self.is_module_body() && self.file.body_form() == BodyForm::Plain
    }

    pub(in crate::lower) fn is_module_body(&self) -> bool {
        matches!(self.key, FunctionKey::ModuleBody(_))
    }

    pub(super) fn get_own_exports(&mut self) -> ValueId {
        let own_file = ModuleRef::File(self.file.file);
        let variable = self.file.ensure_exports_variable(own_file);
        let variable = variable.expect("a file has a variable for its exports");
        self.builder.get_module_variable(variable)
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
        Some(self.emit_named_read(object, name))
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
        let placement = self.file.scopes.placement(binding);
        match placement.map(|placement| placement.storage) {
            Some(Storage::Field { .. } | Storage::Variable(_)) => true,
            Some(Storage::Local) | None => false,
        }
    }

    // What stands in front of the first dot does what it always did: a name may be in its dead zone, and a call of `require` evaluates the module.
    fn lower_root(&mut self, access: ExprId) -> Option<ValueId> {
        let hir = self.file.hir;
        let mut root = access;
        while let Some((object, _)) = hir.member_key(root) {
            root = self.file.skip_type_syntax(object);
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
            // A name that holds the one value of a module, whose members are variables all the same.
            None => self.file.scopes.form(holder) == BindingForm::Stored,
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

    fn emit_evaluated_namespace(&mut self, module: ModuleRef) -> ValueId {
        let module = self.file.fragment.declare_module(module);
        let phase = ImportPhase::Evaluation;
        self.builder.module_namespace(module, phase)
    }

    // The module whose exports stand in front of the last dot of `R.N(..)`.
    fn find_receiver_view(&self, access: ExprId) -> Option<View> {
        let file = &*self.file;
        let (object, _) = file.hir.member_key(access)?;
        let object = file.skip_type_syntax(object);
        let own_exports = View::Exports(ModuleRef::File(file.file));
        let view = file.find_view(object);
        view.or_else(|| self.is_exports_mention(object).then_some(own_exports))
    }

    /// `this` of a call of a bound member. A module without an object has only functions that do not look at it.
    pub(in crate::lower) fn lower_export_receiver(&mut self, access: ExprId) -> ValueId {
        let receiver = match self.find_receiver_view(access) {
            Some(View::Namespace(module)) if self.file.inputs.modules.is_left_out(module) => None,
            Some(View::Namespace(module)) => Some(self.emit_evaluated_namespace(module)),
            Some(View::Exports(module)) => emit_module_value(self, module),
            None => None,
        };
        receiver.unwrap_or_else(|| self.builder.undefined())
    }

    // `module.exports`, as it is written.
    fn is_module_exports_access(&self, access: ExprId) -> bool {
        let file = &*self.file;
        let key = file.hir.member_key(access);
        key.is_some_and(|(_, key)| key == MemberKey::Name(known::exports))
            && file.body_form() == BodyForm::Plain
            && file.builtins.builtin_of_expression(access) == Some(BuiltinId::ModuleObjectExports)
    }

    // `exports`, `module.exports` or `this` at the top of the module.
    fn is_exports_mention(&self, expression: ExprId) -> bool {
        let file = &*self.file;
        if file.body_form() != BodyForm::Plain {
            return false;
        }
        match file.hir[expression].kind {
            // The table of built-ins also follows a stable `var u = exports`. It says nothing of a name that is stored to.
            ExprKind::Ident(_) => {
                file.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports)
                    || file.builtins.builtin_of_expression(expression)
                        == Some(BuiltinId::ModuleObjectExports)
            }
            ExprKind::This => self.is_this_of_module(),
            _ => self.is_module_exports_access(expression),
        }
    }

    /// A read of `module.exports` is a read of the variable, and of one of the five names what the name stands for.
    pub(in crate::lower) fn try_lower_mention(&mut self, expression: ExprId) -> Option<ValueId> {
        if let Some(value) = self.try_lower_module_field(expression) {
            return Some(value);
        }
        if self.is_module_exports_access(expression) {
            let module = ModuleRef::File(self.file.file);
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
            Binding::CommonJs(variable) => Some(self.get_commonjs_variable(variable)),
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => None,
        }
    }

    /// `module.exports = value` stores the variable. Where the module has no object, the statement that stores is lowered as a whole.
    fn lower_module_exports_reference(&mut self, access: ExprId) -> Option<Reference> {
        let module = ModuleRef::File(self.file.file);
        if !self.is_module_exports_access(access) || self.file.is_asked_of_module_object(module) {
            return None;
        }
        let holder = None;
        Some(match self.file.ensure_own_exports_variable() {
            Some(variable) => Reference::ModuleVariable { variable, holder },
            None => Reference::Discarded { holder },
        })
    }

    /// `delete module.exports`: from then on `module.exports` reads `undefined`, and so does whoever requires the module.
    pub(in crate::lower) fn try_lower_exports_deletion(
        &mut self,
        access: ExprId,
    ) -> Option<ValueId> {
        let module = ModuleRef::File(self.file.file);
        if !self.is_module_exports_access(access) || self.file.is_asked_of_module_object(module) {
            return None;
        }
        let variable = self.file.ensure_own_exports_variable()?;
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

    // `module.exports = value` and `exports = module.exports = value`: the value.
    fn find_exports_store(&self, expression: ExprId) -> Option<ExprId> {
        let file = &*self.file;
        let (target, value) = find_plain_store(file, expression)?;
        if self.is_module_exports_access(target) {
            return Some(value);
        }
        let (inner_target, inner_value) = find_plain_store(file, value)?;
        let names_exports = self.is_module_exports_access(inner_target)
            && matches!(file.hir[target].kind, ExprKind::Ident(_))
            && self.is_exports_mention(target);
        names_exports.then_some(inner_value)
    }

    /// `module.exports = { a, b: v, c() {} }` of a module without an object, and `export = { .. }` of TypeScript, which is the same statement: all values, then the stores. A name that nobody reads has no variable.
    pub(in crate::lower) fn try_lower_export_assignment(&mut self, literal: ExprId) -> bool {
        let hir = self.file.hir;
        let module = ModuleRef::File(self.file.file);
        match self.file.inputs.modules.shape(module) {
            Shape::Names => {}
            Shape::Value | Shape::EsModule | Shape::AsToday => return false,
        }
        let literal = self.file.skip_type_syntax(literal);
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
        let store = self.find_exports_store(expression);
        store.is_some_and(|value| self.try_lower_export_assignment(value))
    }
}

/// What `require` of an evaluated module answers. `None`: the module has no object, and nobody asks for one.
pub(in crate::lower) fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<ValueId> {
    match lowering.file.inputs.modules.shape(module) {
        Shape::EsModule => Some(lowering.emit_evaluated_namespace(module)),
        Shape::Value | Shape::AsToday if lowering.file.is_asked_of_module_object(module) => {
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
