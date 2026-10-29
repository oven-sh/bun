use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingStability, Decl};
use bun_sema::hir::{
    ClassId, ExprId, ExprKind, Flags, FnBody, FnId, NodeData, PatId, PatKind, StmtId, VarDeclId,
    VarKind,
};

use crate::ir::generated::{RuntimeErrorKind, TypeSiteKind};
use crate::lower::expression::{Evaluation, Tail, TailCast};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, control, scope};

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
        if self.initialize_holder(decl.pat, initializer) {
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
                    .function_name_key(binding, name, hir[decl.pat].pos);
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
        if file.inputs.modules.holder(file.file, symbol).is_none() {
            return false;
        }
        let held = self.lower_expression(initializer);
        self.set_position(self.file.hir[pattern].pos);
        self.initialize_converted_symbol(symbol, name, held);
        true
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
