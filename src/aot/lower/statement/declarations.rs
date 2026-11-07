use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingStability, Decl};
use bun_sema::hir::{
    ClassId, ExprId, ExprKind, Flags, FnBody, FnId, NodeData, PatId, PatKind, StmtId, VarDeclId,
    VarKind,
};

use bun_sema::program::Sym;
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::generated::{BlockFrequency, RuntimeErrorKind, TypeSiteKind};
use crate::ir::{BlockId, ValueId, VariableKey};
use crate::lower::call::emit_call;
use crate::lower::expression::{Evaluation, Tail, TailCast};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, control, scope};
use crate::modules::ShownNames;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn last_mapped_declaration_position(
        &self,
        declaration: VarDeclId,
        before: u32,
    ) -> u32 {
        let decl = self.hir[declaration];
        match decl.init.some() {
            Some(initializer) => self.last_mapped_position(initializer),
            None => self
                .last_mapped_pattern_position(decl.pat)
                .unwrap_or(before),
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    /// `mapped` is the last token before the declaration that the source map of Bun's transpiler knows.
    pub(crate) fn lower_variable_declaration(&mut self, declaration: VarDeclId, mapped: u32) {
        // Bun's transpiler prints no declaration for a constant that it prints as its value.
        let is_printed = !self.file.is_replaced_by_its_value(declaration);
        let were_suspended = self.builder.suspend_records(true);
        if is_printed {
            self.builder.suspend_records(were_suspended);
        }
        self.lower_printed_variable_declaration(declaration, mapped);
        self.builder.suspend_records(were_suspended);
    }

    fn lower_printed_variable_declaration(&mut self, declaration: VarDeclId, mapped: u32) {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let decl = hir[declaration];
        if decl.flags.contains(Flags::AMBIENT) || self.is_unread_export(decl.pat) {
            return;
        }
        let left_out = self.file.inputs.library_functions.left_out_declarations();
        if left_out.is_declarator_left_out(self.file.file, declaration) {
            if let Some(ExprKind::Class(class)) = decl.init.some().map(|value| hir[value].kind) {
                self.lower_checks_of_left_out_class(class);
            }
            return;
        }
        let Some(initializer) = decl.init.some() else {
            match bound.variable_kind(hir, declaration) {
                VarKind::Let => self.initialize_let_to_undefined(decl.pat),
                VarKind::Var | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {}
            }
            return;
        };
        if self.initialize_holder(decl.pat, initializer) || self.initialize_holder_of_copy(decl.pat)
        {
            return;
        }
        let dynamic_scope = bound.dynamic_lookup_scope(NodeData::Pat(decl.pat));
        let target = dynamic_scope.map(|_| self.resolve_pattern_target(decl.pat));
        let value = match hir[decl.pat].kind {
            // `export const f = function () {}` in a namespace is the store `N.f = function () {}`, which names nothing.
            PatKind::Ident(_) if self.is_container_member(decl.pat) => {
                self.lower_expression(initializer)
            }
            PatKind::Ident(name) => {
                let binding = bound.initialized_binding(decl.pat);
                let key = self
                    .file
                    .given_name_key(initializer, binding, name, hir[decl.pat].pos);
                let is_returned = self.file.find_return_printed_with(declaration).is_some();
                let is_tail = is_returned && control::allows_tail_call(self);
                let is_annotated = decl.ty.is_some() && self.file.is_checked();
                let annotation = (is_tail && is_annotated).then(|| TailCast {
                    position: self
                        .file
                        .annotation_position(decl.ty, TypeSiteKind::Variable),
                    outer: None,
                });
                let tail = match is_tail {
                    true => Tail::Yes {
                        casts: annotation.as_ref(),
                    },
                    false => Tail::No,
                };
                let evaluation = Evaluation {
                    name: Some(PropertyName::Constant(key).into()),
                    ..Evaluation::at_tail(tail)
                };
                let name = self.file.recorded_binding_position(decl.pat);
                self.record_store_ahead_of_value(binding, name);
                self.test_object_of_printed_pattern(initializer);
                let records = self.builder.number_of_records();
                let value = self.lower_expression_in(initializer, evaluation);
                let recorded = self.builder.last_recorded_position();
                if let Some(recorded) = recorded
                    && self.builder.number_of_records() != records
                    && self.file.is_initializer_moved(declaration)
                {
                    self.records_of_initializers.insert(initializer, recorded);
                }
                value
            }
            // The pattern takes each name from where the module keeps it, and nothing from what the call yields.
            PatKind::Object(_) if self.file.find_destructured_module(initializer).is_some() => {
                self.lower_expression(initializer)
            }
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
                let value = self.lower_expression(initializer);
                let position = self
                    .file
                    .annotation_position(decl.ty, TypeSiteKind::Variable);
                self.set_position(hir[decl.pat].pos);
                self.convert_initializer(value, position, Some(initializer))
            }
        };
        match target {
            Some(target) => {
                self.set_position(hir[decl.pat].pos);
                self.set_identifier_target(&target, value, Some(initializer));
            }
            None => {
                self.bind_pattern(decl.pat, value, Some(initializer), mapped);
            }
        }
    }

    // Bun's transpiler prints `const a = o.x; const b = o.y;` as `const { x: a, y: b } = o;`, and a pattern tests its value by itself, ahead of the reads.
    fn test_object_of_printed_pattern(&mut self, initializer: ExprId) {
        let hir = self.file.hir;
        let ExprKind::Dot { obj, name, .. } = hir[self.file.skip_type_syntax(initializer)].kind
        else {
            return;
        };
        let object = self.file.skip_type_syntax(obj);
        let transpiled = self.file.transpiled.as_ref();
        let joined = transpiled.and_then(|it| it.find_joined_declarator_at(hir[object].pos));
        let Some(joined) = joined.filter(|joined| joined.is_first) else {
            return;
        };
        let value = self.lower_expression(object);
        self.set_position(joined.printed_object);
        let name = self.file.intern_atom(name);
        let nullish = self.create_unlikely_block();
        self.branch_if_nullish(value, nullish);
        let resume = self.builder.current_block();
        self.continue_in(nullish);
        self.emit_throw_runtime_error(RuntimeErrorKind::NotDestructurable, Some(name));
        self.builder.switch_to(resume);
    }

    // `const a = require(K)`, where every use of `a` is bound to what the module exports.
    fn initialize_holder(&mut self, pattern: PatId, initializer: ExprId) -> bool {
        let file = &*self.file;
        let PatKind::Ident(name) = file.hir[pattern].kind else {
            return false;
        };
        let Binding::Symbol(symbol) = file.bound.initialized_binding(pattern) else {
            return false;
        };
        let Some(call) = file.inputs.modules.call_of_holder(file.file, symbol) else {
            return false;
        };
        let held = self.lower_expression(call.some().unwrap_or(initializer));
        self.set_position(self.file.hir[pattern].pos);
        self.initialize_converted_symbol(symbol, name, held);
        true
    }

    // `var a = __toESM(require(K))`, `const a = __importStar(require(K))`. Each getter of what the helper makes reads its name on what `require` answered, so a variable of its own holds the answer for the names that are read through `a`: where the answer is as plain as `store_plain_answer` asks. Where `a` is only read by name it then holds the answer too, and the helper is not called. In every other case the helper is called as it is written.
    fn initialize_holder_of_copy(&mut self, pattern: PatId) -> bool {
        let file = &*self.file;
        let hir = file.hir;
        let PatKind::Ident(name) = hir[pattern].kind else {
            return false;
        };
        let Binding::Symbol(symbol) = file.bound.initialized_binding(pattern) else {
            return false;
        };
        let modules = file.inputs.modules;
        let answer_alone = modules.holder_of_answer(file.file, symbol);
        let Some((required, copy)) =
            answer_alone.or_else(|| modules.holder_of_copy(file.file, symbol))
        else {
            return false;
        };
        let ExprKind::Call(site) = hir[copy.written].kind else {
            return false;
        };
        let site = hir[site];
        let holder = Sym {
            file: file.file,
            id: symbol,
        };
        let helper = self.lower_expression(site.callee);
        let answer = self.lower_expression(required);
        let mut arguments: SmallVec<[ValueId; 4]> = SmallVec::new();
        arguments.push(answer);
        for argument in hir.ids(site.args).skip(1) {
            arguments.push(self.lower_expression(argument));
        }
        self.set_position(hir[copy.written].pos);
        let held = self.builder.create_variable(None);
        let (as_written, done) = (self.create_block(), self.create_block());
        self.store_plain_answer(holder, answer, copy.shows, as_written);
        match answer_alone {
            Some(_) => {
                self.builder
                    .set_frequency(as_written, BlockFrequency::Unlikely);
                self.builder.write_variable(held, answer);
                self.jump(done);
            }
            None => self.jump(as_written),
        }

        self.continue_in(as_written);
        let made = emit_call(self, helper, None, &arguments);
        self.builder.write_variable(held, made);
        self.jump(done);

        self.continue_in(done);
        let held = self.builder.read_variable(held);
        self.set_position(self.file.hir[pattern].pos);
        self.initialize_converted_symbol(symbol, name, held);
        true
    }

    // Asks the answer, ahead of the helper and by questions that run no code of the program:
    // it has no marker, and right above it stands `Object.prototype` or `Function.prototype`, which a compiled executable lets nobody add a name to. So the helper, whose reads of the marker are all that could run code, runs none: it finds the answer as it is asked here, and no marker;
    // it has each name that is read through the holder, as a name that the helper shows by a getter of its own or, where the property can never change, by the same property.
    // Goes on behind the store where all of that holds, and to `otherwise`, with the variable empty, where it does not.
    fn store_plain_answer(
        &mut self,
        holder: Sym,
        answer: ValueId,
        shown: ShownNames,
        otherwise: BlockId,
    ) {
        let get_prototype_of = self.emit_locked_builtin(BuiltinId::ObjectGetPrototypeOf);
        let above = emit_call(self, get_prototype_of, None, &[answer]);
        let is_known_above = self.create_block();
        let object_prototype = self.emit_locked_builtin(BuiltinId::ObjectPrototype);
        let is_object_prototype = self.builder.strict_eq(above, object_prototype);
        let split = self.split_on_truthiness(is_object_prototype);
        self.builder.switch_to(split.taken);
        self.jump(is_known_above);
        self.builder.switch_to(split.not_taken);
        let function_prototype = self.emit_locked_builtin(BuiltinId::FunctionPrototype);
        let is_function_prototype = self.builder.strict_eq(above, function_prototype);
        self.go_on_if(is_function_prototype, true, otherwise);
        self.jump(is_known_above);
        self.continue_in(is_known_above);

        let marker = self.file.intern_atom(known::__esModule);
        let marker = self.builder.string(marker);
        let has_marker = self.emit_own_property_test(answer, marker);
        self.go_on_if(has_marker, false, otherwise);
        let modules = self.file.inputs.modules;
        for name in modules.names_read_on_answer(holder.file, holder.id) {
            let name = self.file.intern_atom(name);
            let name = self.builder.string(name);
            if shown == ShownNames::Own {
                let has_name = self.emit_own_property_test(answer, name);
                self.go_on_if(has_name, true, otherwise);
                continue;
            }
            let describe = self.emit_locked_builtin(BuiltinId::ObjectGetOwnPropertyDescriptor);
            let description = emit_call(self, describe, None, &[answer, name]);
            let description = self.branch_if_undefined(description, otherwise);
            // Only the description of a property with a value says whether it is writable.
            let writable = self.emit_named_read(description, known::writable);
            self.branch_if_undefined(writable, otherwise);
            if shown == ShownNames::OwnEnumerableWithValue {
                let test = BuiltinId::ObjectPrototypePropertyIsEnumerable;
                let test = self.emit_locked_builtin(test);
                let is_enumerable = emit_call(self, test, Some(answer), &[name]);
                self.go_on_if(is_enumerable, true, otherwise);
            }
        }
        let variable = self
            .file
            .ensure_variable(VariableKey::RequiredAnswer(holder));
        self.builder.put_module_variable(variable, answer);
    }

    fn emit_own_property_test(&mut self, object: ValueId, name: ValueId) -> ValueId {
        let test = self.emit_locked_builtin(BuiltinId::ObjectPrototypeHasOwnProperty);
        emit_call(self, test, Some(object), &[name])
    }

    fn go_on_if(&mut self, value: ValueId, expected: bool, otherwise: BlockId) {
        let split = self.split_on_truthiness(value);
        let (goes_on, leaves) = match expected {
            true => (split.taken, split.not_taken),
            false => (split.not_taken, split.taken),
        };
        self.builder.switch_to(leaves);
        self.jump(otherwise);
        self.builder.switch_to(goes_on);
    }

    fn is_unread_export(&self, pattern: PatId) -> bool {
        let file = &*self.file;
        let unread_exports = file.inputs.modules.unread_exports(file.file);
        if unread_exports.is_empty() {
            return false;
        }
        match file.hir[pattern].kind {
            PatKind::Ident(_) => {
                let symbol = file.bound.declared_symbol(Decl::Var(pattern));
                unread_exports.binary_search(&symbol).is_ok()
            }
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => false,
        }
    }

    fn is_container_member(&self, pattern: PatId) -> bool {
        let bound = self.file.bound;
        let symbol = bound.declared_symbol(Decl::Var(pattern));
        bound.binding_stability(symbol) == BindingStability::ContainerMember
    }

    fn initialize_let_to_undefined(&mut self, pattern: PatId) {
        let bound = self.file.bound;
        let PatKind::Ident(name) = self.file.hir[pattern].kind else {
            return;
        };
        if self.is_container_member(pattern) {
            return;
        }
        let symbol = bound.declared_symbol(Decl::Var(pattern));
        let undefined = self.builder.undefined();
        scope::initialize_binding(self, Binding::Symbol(symbol), name, undefined);
    }

    pub(super) fn lower_function_declaration(&mut self, function: FnId) {
        let (hir, bound) = (self.file.hir, self.file.bound);
        if matches!(hir[function].body, FnBody::None) {
            return;
        }
        let name = hir[function].name;
        self.store_namespace_export(Decl::Fn(function), name);
        let copies = bound.runtime.annex_b_functions();
        let Ok(index) = copies.binary_search_by_key(&function, |copy| copy.function) else {
            return;
        };
        let copy = copies[index];
        let value = self.get_binding(Binding::Symbol(copy.block_symbol), name);
        scope::set_binding(self, Binding::Symbol(copy.var_symbol), name, value);
    }

    pub(super) fn lower_class_statement(&mut self, statement: StmtId, class: ClassId) {
        let hir = self.file.hir;
        if hir[class].flags.contains(Flags::AMBIENT) {
            return;
        }
        let left_out = self.file.inputs.library_functions.left_out_declarations();
        if left_out.is_class_left_out(self.file.file, class) {
            self.lower_checks_of_left_out_class(class);
            return;
        }
        self.lower_class_declaration(class);
        self.set_position(hir[statement].start);
        self.store_namespace_export(Decl::Class(class), hir[class].name);
    }

    fn store_namespace_export(&mut self, declaration: Decl, name: Atom) {
        let bound = self.file.bound;
        let Some(binding) = bound.declared_symbol(declaration).some() else {
            return;
        };
        let member = bound.export_symbol_of_value_symbol_if_exported(binding);
        if member == binding {
            return;
        }
        let value = self.get_binding(Binding::Symbol(binding), name);
        scope::initialize_binding(self, Binding::Symbol(member), name, value);
    }
}
