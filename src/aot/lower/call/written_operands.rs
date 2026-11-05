use bun_sema::bind::Binding;
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{Call, Chain, ExprId, ExprKind, IdList, PatId, PatKind, StmtId};
use smallvec::SmallVec;

use super::{Arguments, Callee, emit_call, emit_call_of};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Mutability, Resolved, table};
use crate::ir::generated::{Layout, LayoutFlags, LayoutKind};
use crate::ir::{LayoutKey, PropertyKeyId, ValueId};
use crate::lower::expression::Tail;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, object};

#[cfg(test)]
mod tests;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn find_object_created_for_maker(
        &self,
        pattern: PatId,
        initializer: ExprId,
        behind: IdList<StmtId>,
    ) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut made = self.skip_type_syntax(initializer);
        while let ExprKind::Assign {
            op: None, value, ..
        } = hir[made].kind
        {
            made = self.skip_type_syntax(value);
        }
        let ExprKind::Call(number) = hir[made].kind else {
            return None;
        };
        if find_locked_builtin(self, hir[number].callee) != Some(BuiltinId::ObjectCreate) {
            return None;
        }
        let PatKind::Ident(_) = hir[pattern].kind else {
            return None;
        };
        let Binding::Symbol(symbol) = bound.initialized_binding(pattern) else {
            return None;
        };
        let mut pending: Vec<TreeNode> = hir.ids(behind).map(TreeNode::Stmt).collect();
        while let Some(node) = pending.pop() {
            if let TreeNode::Expr(expression) = node {
                match hir[expression].kind {
                    ExprKind::Fn(_) | ExprKind::Class(_) => continue,
                    ExprKind::Assign {
                        op: None, target, ..
                    } => {
                        if let ExprKind::Dot { obj, .. } = hir[self.skip_type_syntax(target)].kind
                            && let holder = self.skip_type_syntax(obj)
                            && matches!(hir[holder].kind, ExprKind::Ident(_))
                            && bound.binding(holder) == Binding::Symbol(symbol)
                        {
                            return Some(made);
                        }
                    }
                    _ => {}
                }
            }
            push_children(hir, node, &mut pending);
        }
        None
    }
}

pub(super) fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    callee: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_pure_expr(file.skip_type_syntax(callee)) {
        Some(Resolved::Builtin(path)) => path.locked_builtin().map(table::canonical_id),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn is_fixed_method(&self, method: BuiltinId) -> bool {
        let replaced = self.inputs.replaced_builtins;
        let is_replaced = |place: BuiltinId| replaced.binary_search(&(place as u32)).is_ok();
        table::entry(method).mutability == Mutability::AlwaysLocked
            && !is_replaced(method)
            && !is_replaced(table::canonical_id(method))
    }

    pub(in crate::lower) fn is_array_iterator_protocol_intact(&self) -> bool {
        self.is_fixed_method(BuiltinId::ArrayPrototypeSymbolIterator)
            && self.is_fixed_method(BuiltinId::ArrayIteratorPrototypeNext)
    }

    fn find_array_literal(&self, list: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let mut current = list;
        loop {
            match hir[current].kind {
                ExprKind::Array(_) => return Some(current),
                ExprKind::Satisfies { expr: operand, .. }
                | ExprKind::AsConst(operand)
                | ExprKind::NonNull(operand) => {
                    current = operand;
                }
                _ => return None,
            }
        }
    }

    fn find_written_elements(&self, list: ExprId) -> Option<SmallVec<[ExprId; 8]>> {
        let hir = self.hir;
        let ExprKind::Array(elements) = hir[self.find_array_literal(list)?].kind else {
            return None;
        };
        let elements: SmallVec<[ExprId; 8]> = hir.ids(elements).collect();
        let is_value = |&element: &ExprId| {
            !matches!(hir[element].kind, ExprKind::Missing | ExprKind::Spread(_))
        };
        elements.iter().all(is_value).then_some(elements)
    }

    fn find_written_pairs(&self, list: ExprId) -> Option<SmallVec<[SmallVec<[ExprId; 8]>; 8]>> {
        let mut pairs = SmallVec::new();
        for pair in self.find_written_elements(list)? {
            let pair = self.find_written_elements(pair)?;
            if pair.len() < 2 {
                return None;
            }
            pairs.push(pair);
        }
        Some(pairs)
    }

    pub(super) fn find_only_argument(&self, site: Call) -> Option<ExprId> {
        let mut arguments = self.hir.ids(site.args);
        let argument = arguments.next()?;
        let is_spread = matches!(self.hir[argument].kind, ExprKind::Spread(_));
        (arguments.next().is_none() && !is_spread).then_some(argument)
    }

    fn is_made_of_constants(&self, list: ExprId) -> bool {
        self.find_array_literal(list)
            .is_some_and(|literal| self.decisions().is_data_literal(literal))
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_method_call(
        &mut self,
        method: BuiltinId,
        this: ValueId,
        arguments: &[ValueId],
    ) -> ValueId {
        let callee = self.emit_builtin_itself(method);
        emit_call(self, callee, Some(this), arguments)
    }

    fn lower_rest_of_pair(&mut self, pair: &[ExprId]) {
        for &unread in &pair[2..] {
            self.lower_taken_value_for_effect(unread);
        }
    }

    fn lower_object_from_entries(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        let list = self.file.find_only_argument(site)?;
        let pairs = self.file.find_written_pairs(list)?;
        if pairs.is_empty()
            || !self.may_wait_with(pairs.len())
            || !self.file.is_array_iterator_protocol_intact()
        {
            return None;
        }
        self.emit_locked_builtin(BuiltinId::ObjectFromEntries);
        let mut entries: SmallVec<[(PropertyName, ValueId); 8]> = SmallVec::new();
        for pair in &pairs {
            let key = self.lower_computed_key(pair[0]);
            let value = self.lower_expression(pair[1]);
            self.lower_rest_of_pair(pair);
            entries.push((key, value));
        }
        self.set_position(self.file.hir[call].pos);

        let mut names: SmallVec<[(PropertyKeyId, ObjectMemberKind); 8]> = SmallVec::new();
        for &(key, _) in &entries {
            if let PropertyName::Constant(key) = key {
                names.push((key, ObjectMemberKind::Field));
            }
        }
        if names.len() == entries.len() {
            let layout = self.file.untyped_layout(&names);
            let mut made = self.begin_object(layout);
            for (key, value) in entries {
                self.add_property(&mut made, key, value, None);
            }
            let made = object::finish_object(self, made);
            return Some(self.claim_call_result(call, made));
        }

        let made = self.builder.new_dictionary();
        let outer = self
            .builder
            .set_tail_position(matches!(tail, Tail::Yes { .. }));
        self.set_position(self.file.call_position(site));
        for (key, value) in entries {
            self.emit_define_inside(made, key, value, Some(BuiltinId::ObjectFromEntries));
        }
        self.builder.set_tail_position(outer);
        self.set_position(self.file.hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    fn lower_definition_by_descriptors(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let hir = self.file.hir;
        let arguments: SmallVec<[ExprId; 4]> = hir.ids(site.args).collect();
        let &[target, descriptors] = arguments.as_slice() else {
            return None;
        };
        if matches!(hir[target].kind, ExprKind::Spread(_)) {
            return None;
        }
        let ExprKind::Call(description) = hir[descriptors].kind else {
            return None;
        };
        let description = hir[description];
        if !matches!(description.chain, Chain::No)
            || find_locked_builtin(self.file, description.callee)
                != Some(BuiltinId::ObjectGetOwnPropertyDescriptors)
        {
            return None;
        }
        let source = self.file.find_only_argument(description)?;

        self.emit_locked_builtin(BuiltinId::ObjectDefineProperties);
        let target = self.lower_expression(target);
        self.emit_locked_builtin(BuiltinId::ObjectGetOwnPropertyDescriptors);
        let source = self.lower_expression(source);
        self.set_position(self.file.call_position(description));
        let describe = BuiltinId::CompilerHelpersDescribeUnlessOrdinary;
        let described = self.emit_builtin_call(describe, &[source]);

        let mut written = [target, described];
        self.convert_arguments(call, &mut written);
        let [target, described] = written;
        self.set_position(self.file.call_position(site));
        let define = self.emit_locked_builtin(BuiltinId::CompilerHelpersDefinePropertiesFrom);
        let define = Callee::without_key(define, None, self.file.find_callee_name(site.callee));
        let arguments = Arguments::Values(SmallVec::from_slice(&[target, described, source]));
        let defined = emit_call_of(self, define, arguments);
        self.set_position(hir[call].pos);
        Some(self.claim_call_result(call, defined))
    }

    pub(super) fn try_lower_builtin_call_in_place(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        if !matches!(site.chain, Chain::No) {
            return None;
        }
        match find_locked_builtin(self.file, site.callee) {
            Some(BuiltinId::ObjectFromEntries) => self.lower_object_from_entries(call, site, tail),
            Some(BuiltinId::ObjectDefineProperties) => {
                self.lower_definition_by_descriptors(call, site)
            }
            Some(BuiltinId::ArrayFrom) => self.lower_array_from(call, site, tail),
            Some(BuiltinId::Object) => self.lower_empty_object(call, site),
            Some(BuiltinId::ObjectCreate) => self.lower_object_created_below(call, site, tail),
            Some(BuiltinId::ObjectAssign) => self.lower_assignment_to_new_object(call, site, tail),
            Some(_) => None,
            None => self.try_lower_method_call(call, site, tail),
        }
    }

    fn lower_object_created_below(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        if self.object_created_for_maker != Some(call) {
            return None;
        }
        let parent = self.file.find_only_argument(site)?;
        let ExprKind::Call(number) = self.file.hir[call].kind else {
            return None;
        };
        let written = self.file.skip_type_syntax(parent);
        let is_prototype_of_function = match self.file.hir[written].kind {
            ExprKind::Dot { name, .. } => self.file.queries.atom_bytes(name) == b"prototype",
            _ => false,
        };
        if is_prototype_of_function || matches!(self.file.hir[written].kind, ExprKind::Null) {
            return None;
        }
        let parent = self.lower_expression(parent);
        self.set_position(self.file.call_position(site));
        self.quote_if_next_fails(call);
        let layout = self.file.fragment.declare_layout(LayoutKey::CreatedObject {
            file: self.file.file,
            call: u32::from(number),
        });
        if !self.file.fragment.is_layout_defined(layout) {
            let definition = Layout {
                kind: LayoutKind::Instance,
                module: Some(self.file.module_id()),
                position: self.file.hir[call].pos,
                flags: LayoutFlags::IS_OF_CREATED_OBJECT,
                ..Layout::default()
            };
            self.file.fragment.define_layout(layout, definition);
        }
        self.file.fragment.note_allocation(layout);
        let head = self.builder.new_object(layout, &[], None, &[]);
        let outer = self
            .builder
            .set_tail_position(matches!(tail, Tail::Yes { .. }));
        self.builder.set_literal_prototype(head, parent, true);
        self.builder.set_tail_position(outer);
        let made = self.builder.finish_object(head);
        self.set_position(self.file.hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    fn emit_empty_collection(
        &mut self,
        expression: ExprId,
        site: Call,
        constructor: BuiltinId,
    ) -> ValueId {
        self.set_position(self.file.construct_position(expression));
        let function = self.emit_locked_builtin(constructor);
        let name = self.file.find_callee_name(site.callee);
        self.emit_construct(function, Arguments::Values(SmallVec::new()), name)
    }

    fn lower_map_of_entries(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        let list = self.file.find_only_argument(site)?;
        if self.file.is_made_of_constants(list)
            || !self.file.is_fixed_method(BuiltinId::MapPrototypeSet)
            || !self.file.is_array_iterator_protocol_intact()
        {
            return None;
        }
        let pairs = self.file.find_written_pairs(list)?;
        let map = self.emit_empty_collection(expression, site, BuiltinId::Map);
        for pair in &pairs {
            let key = self.lower_expression(pair[0]);
            let value = self.lower_expression(pair[1]);
            self.lower_rest_of_pair(pair);
            self.set_position(self.file.construct_position(expression));
            self.emit_method_call(BuiltinId::MapPrototypeSet, map, &[key, value]);
        }
        self.set_position(self.file.hir[expression].pos);
        Some(self.claim_call_result(expression, map))
    }

    fn lower_set_of_values(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        let list = self.file.find_only_argument(site)?;
        if self.file.is_made_of_constants(list)
            || !self.file.is_fixed_method(BuiltinId::SetPrototypeAdd)
            || !self.file.is_array_iterator_protocol_intact()
        {
            return None;
        }
        let elements = self.file.find_written_elements(list)?;
        let set = self.emit_empty_collection(expression, site, BuiltinId::Set);
        for &element in &elements {
            let value = self.lower_expression(element);
            self.set_position(self.file.construct_position(expression));
            self.emit_method_call(BuiltinId::SetPrototypeAdd, set, &[value]);
        }
        self.set_position(self.file.hir[expression].pos);
        Some(self.claim_call_result(expression, set))
    }

    pub(super) fn try_lower_builtin_construct_in_place(
        &mut self,
        expression: ExprId,
        site: Call,
    ) -> Option<ValueId> {
        match find_locked_builtin(self.file, site.callee)? {
            BuiltinId::Map => self.lower_map_of_entries(expression, site),
            BuiltinId::Set => self.lower_set_of_values(expression, site),
            BuiltinId::Object => self.lower_empty_object(expression, site),
            BuiltinId::Array => self.lower_empty_array(expression, site),
            _ => None,
        }
    }

    fn lower_empty_array(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        if !site.args.is_empty() {
            return None;
        }
        let contents = self.file.array_literal_contents(expression);
        let position = self.file.hir[expression].pos;
        let made = self.lower_elements(contents, &[], &[], position);
        Some(self.claim_call_result(expression, made))
    }

    fn lower_empty_object(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        if !site.args.is_empty() {
            return None;
        }
        self.set_position(self.file.hir[expression].pos);
        let layout = self.file.untyped_layout(&[]);
        let made = self.begin_object(layout);
        Some(object::finish_object(self, made))
    }
}
