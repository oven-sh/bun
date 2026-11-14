use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingStability, Decl, SymbolId};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{
    ClassId, ExprId, ExprKind, Flags, FnBody, FnId, IdList, NodeData, PatId, PatKind, StmtId,
    StmtKind, VarDeclId, VarKind,
};
use bun_sema::program::Sym;
use smallvec::SmallVec;

use super::statements_behind;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, DeclaredType, LocalVariable, TypeTable, ValueId, VariableKey};
use crate::lower::call::emit_call;
use crate::lower::expression::{Evaluation, Tail, TailCast};
use crate::lower::member::PropertyName;
use crate::lower::object::finish_object;
use crate::lower::{FileLowering, FunctionLowering, control, scope};
use crate::modules::{CopiedExports, ShownNames};

impl FileLowering<'_, '_, '_, '_> {
    fn find_variable_named_once(&self, declaration: VarDeclId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let decl = hir[declaration];
        let kind = bound.variable_kind(hir, declaration);
        let is_plain = matches!(kind, VarKind::Let | VarKind::Const)
            && matches!(hir[decl.pat].kind, PatKind::Ident(_))
            && decl.init.is_some()
            && !decl.flags.intersects(Flags::AMBIENT | Flags::EXPORT);
        if !is_plain {
            return None;
        }
        match bound.initialized_binding(decl.pat) {
            Binding::Symbol(symbol)
                if self.scopes.is_named_once(symbol) && !bound.is_visible_to_eval(symbol) =>
            {
                Some(symbol)
            }
            _ => None,
        }
    }

    fn find_printed_statement(&self, list: IdList<StmtId>) -> Option<(StmtId, IdList<StmtId>)> {
        let hir = self.hir;
        let index = hir.ids(list).position(|statement| {
            !matches!(
                hir[statement].kind,
                StmtKind::Empty | StmtKind::Interface(_) | StmtKind::TypeAlias(_)
            )
        })?;
        let behind = statements_behind(list, index as u32);
        Some((hir.id_at(list, index), behind))
    }

    fn push_casts_around_name(
        &mut self,
        value: ExprId,
        symbol: SymbolId,
        casts: &mut SmallVec<[DeclaredType; 2]>,
    ) -> bool {
        let hir = self.hir;
        let first = casts.len();
        let mut current = value;
        while let Some(operand) = hir.type_assertion_operand(current) {
            if let ExprKind::As { ty, .. } = hir[current].kind
                && self.is_checked()
            {
                casts.push(self.assertion_position(ty));
            }
            current = operand;
        }
        casts[first..].reverse();
        matches!(hir[current].kind, ExprKind::Ident(_))
            && self.bound.binding(current) == Binding::Symbol(symbol)
    }

    fn is_any_named_where_never_reached(&self, list: IdList<StmtId>, symbols: &[SymbolId]) -> bool {
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions());
        let never_reached = hir.ids(list).filter(|&it| decisions.is_dead_stmt(it));
        let mut pending: Vec<TreeNode> = never_reached.map(TreeNode::Stmt).collect();
        while let Some(node) = pending.pop() {
            if let TreeNode::Expr(expression) = node
                && let ExprKind::Ident(_) = hir[expression].kind
                && let Binding::Symbol(symbol) = bound.binding(expression)
                && symbols.contains(&symbol)
            {
                return true;
            }
            push_children(hir, node, &mut pending);
        }
        false
    }

    fn find_casts_up_to_return(
        &mut self,
        first: VarDeclId,
        mut behind: IdList<StmtId>,
    ) -> Option<SmallVec<[DeclaredType; 2]>> {
        let (hir, bound) = (self.hir, self.bound);
        let initializer = self.skip_type_syntax(hir[first].init);
        if matches!(hir[initializer].kind, ExprKind::Ident(_))
            || self.is_class_named_by_its_declaration(initializer)
            || self.stands_as_written(hir[initializer].pos)
        {
            return None;
        }
        let mut casts = SmallVec::new();
        let mut row: SmallVec<[SymbolId; 2]> = SmallVec::new();
        let mut next = Some(first);
        while let Some(declaration) = next {
            let symbol = self.find_variable_named_once(declaration)?;
            row.push(symbol);
            if self.is_checked() {
                casts.push(self.annotation_position(hir[declaration].ty));
            }
            let StmtKind::Var(declarations) = hir[bound.var_stmt[declaration.idx()]].kind else {
                return None;
            };
            let place = declarations.position_of(declaration.idx())? + 1;
            next = (place < declarations.len()).then(|| declarations.at(place));
            let value = match next {
                Some(next) => hir[next].init,
                None => {
                    let (statement, rest) = self.find_printed_statement(behind)?;
                    behind = rest;
                    match hir[statement].kind {
                        StmtKind::Return(value) => value,
                        StmtKind::Var(declarations) => {
                            next = declarations.iter().next();
                            hir[next?].init
                        }
                        _ => return None,
                    }
                }
            };
            if !self.push_casts_around_name(value.some()?, symbol, &mut casts) {
                return None;
            }
        }
        (!self.is_any_named_where_never_reached(behind, &row)).then_some(casts)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_variable_declaration(&mut self, declaration: VarDeclId) {
        self.lower_variable_declaration_in_list(declaration, IdList::EMPTY);
    }

    fn lower_returned_initializer(
        &mut self,
        initializer: ExprId,
        casts: &[DeclaredType],
    ) -> ValueId {
        let casts = TailCast {
            positions: casts,
            outer: None,
            breaks_no_int32_promise: false,
        };
        let tail = match control::allows_tail_call_of(self, initializer) {
            true => Tail::Yes {
                casts: Some(&casts),
            },
            false => Tail::No,
        };
        self.lower_expression_in(initializer, Evaluation::at_tail(tail))
    }

    pub(super) fn lower_variable_declaration_in_list(
        &mut self,
        declaration: VarDeclId,
        behind: IdList<StmtId>,
    ) {
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
        if self.leaves_function_unmade(decl.pat) {
            return;
        }
        if !behind.is_empty() {
            self.note_closing_loop(decl.pat, initializer, behind);
        }
        if let Some((made, names)) =
            self.file
                .find_object_created_for_maker(decl.pat, initializer, behind)
        {
            self.object_created_for_maker = Some(made);
            self.names_that_maker_stores_under = names;
        }
        let dynamic_scope = bound.dynamic_lookup_scope(NodeData::Pat(decl.pat));
        let target = dynamic_scope.map(|_| self.resolve_pattern_target(decl.pat));
        let value = match hir[decl.pat].kind {
            PatKind::Ident(_)
                if self.is_container_member(decl.pat)
                    && !self.file.is_class_named_by_its_declaration(initializer) =>
            {
                self.lower_expression(initializer)
            }
            PatKind::Ident(name) => {
                let casts = match target.is_none() && !self.drops_returned_value() {
                    true => self.file.find_casts_up_to_return(declaration, behind),
                    false => None,
                };
                match casts {
                    Some(casts) => self.lower_returned_initializer(initializer, &casts),
                    None => {
                        let binding = bound.initialized_binding(decl.pat);
                        let name = self.file.name_given_by_binding(binding, name);
                        self.lower_named_evaluation(initializer, name)
                    }
                }
            }
            PatKind::Object(_) if self.file.find_destructured_module(initializer).is_some() => {
                self.lower_destructured_module(decl.pat, initializer)
            }
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
                let value = self.lower_expression(initializer);
                let position = self.file.annotation_position(decl.ty);
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
                self.bind_pattern(decl.pat, value, Some(initializer));
            }
        }
    }

    fn leaves_function_unmade(&mut self, pattern: PatId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let PatKind::Ident(name) = hir[pattern].kind else {
            return false;
        };
        let binding = bound.initialized_binding(pattern);
        let Binding::Symbol(symbol) = binding else {
            return false;
        };
        let is_only_a_name = self.file.scopes.is_never_named(symbol)
            && !bound.is_visible_to_eval(symbol)
            && bound.symbol(symbol).parent.is_none()
            && bound.is_stable_binding(symbol)
            && !(self.file.inputs.modules.commonjs()).is_exported_binding(self.file.file, symbol);
        if !is_only_a_name {
            return false;
        }
        let Some(function) = scope::find_function_that_initializes(hir, bound, symbol) else {
            return false;
        };
        let given = self.file.name_given_by_binding(binding, name);
        self.declare_function_named_by(function, given);
        true
    }

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
        let holder = Sym {
            file: file.file,
            id: symbol,
        };
        if copy.wraps_unmarked_answer {
            let inputs = file.inputs;
            // A coverage report counts the calls of a helper.
            if inputs.options.counts_executions && inputs.sources.is_in_coverage_report(holder.file)
            {
                return false;
            }
            let assigned = match hir[copy.written].kind {
                ExprKind::Cond { test, .. } => match hir[test].kind {
                    ExprKind::Binary { left, .. } => left,
                    _ => return false,
                },
                _ => required,
            };
            let answer = self.lower_expression(assigned);
            self.set_position(hir[copy.written].pos);
            let held = self.lower_unmarked_answer(holder, answer, copy.written);
            self.set_position(self.file.hir[pattern].pos);
            self.initialize_converted_symbol(symbol, name, held);
            return true;
        }
        let ExprKind::Call(site) = hir[copy.written].kind else {
            return false;
        };
        let site = hir[site];
        let helper = self.lower_expression(site.callee);
        let answer = self.lower_expression(required);
        let mut arguments: SmallVec<[ValueId; 4]> = SmallVec::new();
        arguments.push(answer);
        for argument in hir.ids(site.args).skip(1) {
            arguments.push(self.lower_expression(argument));
        }
        self.set_position(hir[copy.written].pos);
        let modules = self.file.inputs.modules;
        let reads_default_alone = answer_alone.is_some()
            && modules
                .names_read_on_answer(holder.file, holder.id)
                .is_empty();
        if reads_default_alone {
            let held = self.lower_default_of_copy(holder, answer, copy);
            self.set_position(self.file.hir[pattern].pos);
            self.initialize_converted_symbol(symbol, name, held);
            return true;
        }
        let held = self.builder.create_variable(None);
        let (as_written, done) = (self.create_block(), self.create_block());
        self.store_plain_answer(holder, answer, copy.shows, as_written);
        match answer_alone {
            Some(_) => {
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

    /// What `import_a.default` finds on the copy, without the copy: nothing else is asked of it.
    fn lower_default_of_copy(
        &mut self,
        holder: Sym,
        answer: ValueId,
        copy: CopiedExports,
    ) -> ValueId {
        let held = self.builder.create_variable(None);
        let shown = self.builder.create_variable(None);
        let (plain, is_shown, done) = (
            self.create_block(),
            self.create_block(),
            self.create_block(),
        );
        if copy.passes_over_marker {
            self.jump(plain);
        } else {
            let marked = self.branch_if_nullish(answer, plain);
            let marker = self.emit_named_read(marked, known::__esModule);
            self.go_on_if(marker, true, plain);
            let name = self.file.intern_atom(known::default);
            let name = self.builder.string(name);
            let owns_default = self.emit_own_property_test(marked, name);
            let lacks_default = match copy.reads_own_default {
                true => plain,
                false => self.create_block(),
            };
            self.go_on_if(owns_default, true, lacks_default);
            self.builder.write_variable(held, marked);
            self.jump(done);
            if lacks_default != plain {
                // The copy has no default of its own either: what stands above it stands above the value.
                self.continue_in(lacks_default);
                let inherited = self.emit_named_read(marked, known::default);
                self.builder.write_variable(shown, inherited);
                self.jump(is_shown);
            }
        }
        self.continue_in(plain);
        self.builder.write_variable(shown, answer);
        self.jump(is_shown);

        self.continue_in(is_shown);
        let variable = self
            .file
            .ensure_variable(VariableKey::RequiredAnswer(holder));
        let shown = self.builder.read_variable(shown);
        self.builder.put_module_variable(variable, shown);
        self.builder.write_variable(held, answer);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(held)
    }

    /// `answer && answer.__esModule ? answer : { default: answer }`, without the object where only its default is read: the
    /// variable of the holder keeps it.
    fn lower_unmarked_answer(&mut self, holder: Sym, answer: ValueId, written: ExprId) -> ValueId {
        let held = self.builder.create_variable(None);
        let (wraps, is_plain, done) = (
            self.create_block(),
            self.create_block(),
            self.create_block(),
        );
        let split = self.split_on_type(answer, TypeTable::FUNCTION);
        self.builder.switch_to(split.not_taken);
        self.hold_marked_answer(split.not_taken_value, (held, done), wraps);
        self.continue_in(wraps);
        let wrapper = self.emit_wrapper(written, answer);
        self.builder.write_variable(held, wrapper);
        self.jump(done);
        self.builder.switch_to(split.taken);
        let function = split.taken_value;
        self.hold_marked_answer(function, (held, done), is_plain);
        self.continue_in(is_plain);
        let variable = VariableKey::RequiredAnswer(holder);
        let variable = self.file.ensure_variable(variable);
        self.builder.put_module_variable(variable, function);
        self.builder.write_variable(held, function);
        self.jump(done);
        self.continue_in(done);
        self.builder.read_variable(held)
    }

    fn hold_marked_answer(
        &mut self,
        answer: ValueId,
        (held, done): (LocalVariable, BlockId),
        otherwise: BlockId,
    ) {
        let split = self.split_on_truthiness(answer);
        self.builder.switch_to(split.not_taken);
        self.jump(otherwise);
        self.builder.switch_to(split.taken);
        let marker = self.emit_named_read(answer, known::__esModule);
        self.go_on_if(marker, true, otherwise);
        self.builder.write_variable(held, answer);
        self.jump(done);
    }

    fn emit_wrapper(&mut self, written: ExprId, answer: ValueId) -> ValueId {
        let hir = self.file.hir;
        if let ExprKind::Cond { branches, .. } = hir[written].kind {
            return self.lower_expression(hir.branches(branches).no);
        }
        let name = self.file.name_key(known::default);
        let members = [(name, ObjectMemberKind::Field)];
        let layout = self.file.layout_of_names_made_at(written, &members);
        let mut wrapper = self.begin_object(layout);
        self.add_property(&mut wrapper, PropertyName::Constant(name), answer, None);
        finish_object(self, wrapper)
    }

    fn store_plain_answer(
        &mut self,
        holder: Sym,
        answer: ValueId,
        shown: ShownNames,
        otherwise: BlockId,
    ) {
        let answer = self.branch_if_nullish(answer, otherwise);
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

        let marker = PropertyName::Constant(self.file.atom_key(known::__esModule));
        let has_marker = self.emit_has(answer, marker);
        self.go_on_if(has_marker, false, otherwise);
        let modules = self.file.inputs.modules;
        for &(_, name) in modules.names_read_on_answer(holder.file, holder.id) {
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

    pub(in crate::lower) fn emit_own_property_test(
        &mut self,
        object: ValueId,
        name: ValueId,
    ) -> ValueId {
        let test = self.emit_locked_builtin(BuiltinId::ObjectPrototypeHasOwnProperty);
        emit_call(self, test, Some(object), &[name])
    }

    pub(in crate::lower) fn go_on_if(
        &mut self,
        value: ValueId,
        expected: bool,
        otherwise: BlockId,
    ) {
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
        let member = bound.exported_value(binding);
        if member == binding || !bound.is_exported_by_container(declaration) {
            return;
        }
        let value = self.get_binding(Binding::Symbol(binding), name);
        scope::initialize_binding(self, Binding::Symbol(member), name, value);
    }
}
