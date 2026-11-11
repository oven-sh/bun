use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{
    Call, CallId, Chain, ExprId, ExprKind, IdList, NameKind, PatId, PatKind, PropKind, StmtId,
    is_private_name_at, is_proto_setter,
};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::{Arguments, Callee, emit_call, emit_call_of};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Mutability, Resolved, table};
use crate::ir::generated::{Layout, LayoutFlags, LayoutKind};
use crate::ir::{LayoutId, LayoutKey, PropertyKeyId, ValueId};
use crate::lower::context::StoresByNameInList;
use crate::lower::expression::Tail;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, object};
use crate::modules::{DescribedPart, WrittenDescriptor};

#[cfg(test)]
mod tests;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn find_object_created_for_maker(
        &self,
        pattern: PatId,
        initializer: ExprId,
        behind: IdList<StmtId>,
    ) -> Option<(ExprId, Vec<Atom>)> {
        let (hir, bound) = (self.hir, self.bound);
        let mut made = self.skip_type_syntax(initializer);
        while let ExprKind::Assign {
            op: None, value, ..
        } = hir[made].kind
        {
            made = self.skip_type_syntax(value);
        }
        let is_literal_below_null = object::is_empty_without_prototype(hir, made);
        let creates = |number: CallId| {
            find_locked_builtin(self, hir[number].callee) == Some(BuiltinId::ObjectCreate)
        };
        if !is_literal_below_null
            && !matches!(hir[made].kind, ExprKind::Call(number) if creates(number))
        {
            return None;
        }
        let PatKind::Ident(_) = hir[pattern].kind else {
            return None;
        };
        let Binding::Symbol(symbol) = bound.initialized_binding(pattern) else {
            return None;
        };
        let end = behind.start + behind.len;
        let mut lists = self.stores_by_name_in_lists.borrow_mut();
        let list = lists.entry(end).or_insert_with(|| StoresByNameInList {
            looked_at_from: end,
            last_store_of: FxHashMap::default(),
            kept_plain_below_null: FxHashSet::default(),
            names_stored_on: FxHashMap::default(),
        });
        if behind.start < list.looked_at_from {
            let added = IdList::new(behind.start, list.looked_at_from - behind.start);
            self.note_stores_by_name_in(
                added,
                &mut list.last_store_of,
                &mut list.kept_plain_below_null,
                &mut list.names_stored_on,
            );
            list.looked_at_from = behind.start;
        }
        let is_below_null = match hir[made].kind {
            ExprKind::Call(number) => {
                self.find_parent_and_written_map(hir[number])
                    .is_some_and(|(parent, _)| {
                        matches!(hir[self.skip_type_syntax(parent)].kind, ExprKind::Null)
                    })
            }
            _ => is_literal_below_null,
        };
        let brings_map = match hir[made].kind {
            ExprKind::Call(number) => {
                matches!(
                    self.find_parent_and_written_map(hir[number]),
                    Some((_, Some(_)))
                )
            }
            _ => false,
        };
        if is_below_null && list.kept_plain_below_null.contains(&symbol) {
            return None;
        }
        let names = || {
            list.names_stored_on
                .get(&symbol)
                .cloned()
                .unwrap_or_default()
        };
        if brings_map {
            return Some((made, names()));
        }
        let last = *list.last_store_of.get(&symbol)?;
        (last >= behind.start).then(|| (made, names()))
    }

    fn note_stores_by_name_in(
        &self,
        statements: IdList<StmtId>,
        last_store_of: &mut FxHashMap<SymbolId, u32>,
        kept_plain_below_null: &mut FxHashSet<SymbolId>,
        names_stored_on: &mut FxHashMap<SymbolId, Vec<Atom>>,
    ) {
        let (hir, bound) = (self.hir, self.bound);
        let mut pending: Vec<TreeNode> = Vec::new();
        let mut inside_functions: Vec<TreeNode> = Vec::new();
        for (place, statement) in (statements.start..).zip(hir.ids(statements)) {
            pending.push(TreeNode::Stmt(statement));
            while let Some(node) = pending.pop() {
                if let TreeNode::Expr(expression) = node {
                    self.note_what_keeps_plain(expression, kept_plain_below_null);
                    match hir[expression].kind {
                        ExprKind::Fn(_) | ExprKind::Class(_) => {
                            push_children(hir, node, &mut inside_functions);
                            continue;
                        }
                        ExprKind::Assign {
                            op: None, target, ..
                        } => {
                            let target = self.skip_type_syntax(target);
                            if let ExprKind::Dot { obj, name, .. } = hir[target].kind
                                && !is_private_name_at(hir, hir.name_pos(target))
                                && let holder = self.skip_type_syntax(obj)
                                && matches!(hir[holder].kind, ExprKind::Ident(_))
                                && let Binding::Symbol(symbol) = bound.binding(holder)
                            {
                                let last = last_store_of.entry(symbol).or_insert(place);
                                *last = (*last).max(place);
                                let names = names_stored_on.entry(symbol).or_default();
                                if !names.contains(&name) {
                                    names.push(name);
                                }
                            }
                        }
                        ExprKind::Call(_) => {
                            if let Some(symbol) = self.find_holder_of_written_definition(expression)
                            {
                                let last = last_store_of.entry(symbol).or_insert(place);
                                *last = (*last).max(place);
                                names_stored_on.entry(symbol).or_default();
                            }
                        }
                        _ => {}
                    }
                }
                push_children(hir, node, &mut pending);
            }
        }
        while let Some(node) = inside_functions.pop() {
            if let TreeNode::Expr(expression) = node {
                self.note_what_keeps_plain(expression, kept_plain_below_null);
            }
            push_children(hir, node, &mut inside_functions);
        }
    }

    fn lays_value_or_getter(&self, descriptor: ExprId) -> bool {
        WrittenDescriptor::read(self.hir, self.decisions(), descriptor).is_some_and(|written| {
            matches!(
                written.part,
                DescribedPart::Data { value: Some(_), .. }
                    | DescribedPart::Accessor {
                        getter: Some(_),
                        setter: None
                    }
            )
        })
    }

    fn is_map_of_values_and_getters(&self, map: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Object(entries) = hir[self.skip_type_syntax(map)].kind else {
            return false;
        };
        let mut entries = entries.iter().map(|entry| hir[entry]).peekable();
        entries.peek().is_some()
            && entries.all(|entry| {
                entry.kind == PropKind::Init
                    && entry.name_kind == NameKind::Identifier
                    && !is_proto_setter(&entry)
                    && self.lays_value_or_getter(entry.value)
            })
    }

    fn find_parent_and_written_map(&self, site: Call) -> Option<(ExprId, Option<ExprId>)> {
        if let Some(parent) = self.find_only_argument(site) {
            return Some((parent, None));
        }
        let mut operands = self.hir.ids(site.args);
        let (parent, map) = (operands.next()?, operands.next()?);
        let is_spread = matches!(self.hir[parent].kind, ExprKind::Spread(_));
        let is_written =
            operands.next().is_none() && !is_spread && self.is_map_of_values_and_getters(map);
        is_written.then_some((parent, Some(map)))
    }

    fn is_first_operand_of_written_definition(&self, literal: ExprId) -> bool {
        let mut child = literal;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(child) {
            if self.hir.type_assertion_operand(parent) == Some(child) {
                child = parent;
                continue;
            }
            return self.find_operand_that_written_definition_defines_on(parent) == Some(literal);
        }
        false
    }

    fn find_holder_of_written_definition(&self, expression: ExprId) -> Option<SymbolId> {
        let holder = self.find_operand_that_written_definition_defines_on(expression)?;
        match (self.hir[holder].kind, self.bound.binding(holder)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

    fn find_operand_that_written_definition_defines_on(
        &self,
        expression: ExprId,
    ) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Call(number) = hir[expression].kind else {
            return None;
        };
        let mut operands = hir.ids(hir[number].args);
        let holder = self.skip_type_syntax(operands.next()?);
        let is_written = match find_locked_builtin(self, hir[number].callee) {
            Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty) => {
                let (key, descriptor) = (operands.next()?, operands.next()?);
                matches!(hir[self.skip_type_syntax(key)].kind, ExprKind::String(_))
                    && self.lays_value_or_getter(descriptor)
            }
            Some(BuiltinId::ObjectDefineProperties) => {
                self.is_map_of_values_and_getters(operands.next()?)
            }
            _ => false,
        };
        (is_written && operands.next().is_none()).then_some(holder)
    }

    fn note_what_keeps_plain(
        &self,
        expression: ExprId,
        kept_plain_below_null: &mut FxHashSet<SymbolId>,
    ) {
        let (hir, bound) = (self.hir, self.bound);
        if self.find_holder_of_written_definition(expression).is_some() {
            return;
        }
        let named = match hir[expression].kind {
            ExprKind::Assign { target, .. } => match hir[self.skip_type_syntax(target)].kind {
                ExprKind::Index { obj, .. } => Some(obj),
                _ => None,
            },
            ExprKind::Call(number) => match find_locked_builtin(self, hir[number].callee) {
                Some(
                    BuiltinId::ObjectCreate
                    | BuiltinId::ObjectDefineProperty
                    | BuiltinId::ObjectDefineProperties
                    | BuiltinId::ReflectDefineProperty,
                ) => hir.ids(hir[number].args).next(),
                _ => None,
            },
            _ => None,
        };
        if let Some(named) = named
            && let holder = self.skip_type_syntax(named)
            && matches!(hir[holder].kind, ExprKind::Ident(_))
            && let Binding::Symbol(symbol) = bound.binding(holder)
        {
            kept_plain_below_null.insert(symbol);
        }
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
        let (parent, map) = self.file.find_parent_and_written_map(site)?;
        let ExprKind::Call(number) = self.file.hir[call].kind else {
            return None;
        };
        let written = self.file.skip_type_syntax(parent);
        let is_prototype_of_function = match self.file.hir[written].kind {
            ExprKind::Dot { name, .. } => self.file.queries.atom_bytes(name) == b"prototype",
            _ => false,
        };
        let is_below_null = matches!(self.file.hir[written].kind, ExprKind::Null);
        if is_prototype_of_function {
            return None;
        }
        self.lower_expression(site.callee);
        let parent = self.lower_expression(parent);
        let map = map.map(|map| self.lower_expression(map));
        self.set_position(self.file.call_position(site));
        self.quote_if_next_fails(call);
        let layout = match is_below_null {
            true => self.layout_of_record_below_null(call),
            false => self.layout_of_created_object(call, number),
        };
        self.file.fragment.note_allocation(layout);
        let head = self.builder.new_object(layout, &[], None, &[]);
        let outer = self
            .builder
            .set_tail_position(matches!(tail, Tail::Yes { .. }));
        self.builder.set_literal_prototype(head, parent, true);
        self.builder.set_tail_position(outer);
        let made = self.builder.finish_object(head);
        if let Some(map) = map {
            self.emit_builtin_call(BuiltinId::ObjectDefineProperties, &[made, map]);
        }
        self.set_position(self.file.hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    pub(in crate::lower) fn lower_literal_below_null_for_maker(
        &mut self,
        literal: ExprId,
    ) -> Option<ValueId> {
        let layout = if self.object_created_for_maker == Some(literal) {
            self.layout_of_record_below_null(literal)
        } else if self.file.is_first_operand_of_written_definition(literal) {
            self.file.layout_of_names_made_at(literal, &[])
        } else {
            return None;
        };
        let null = self.builder.null();
        self.file.fragment.note_allocation(layout);
        let head = self.builder.new_object(layout, &[], None, &[]);
        self.builder.set_literal_prototype(head, null, true);
        Some(self.builder.finish_object(head))
    }

    fn layout_of_record_below_null(&mut self, call: ExprId) -> LayoutId {
        let names = core::mem::take(&mut self.names_that_maker_stores_under);
        let members: Vec<(PropertyKeyId, ObjectMemberKind)> = names
            .into_iter()
            .map(|name| (self.file.name_key(name), ObjectMemberKind::Field))
            .collect();
        self.file.layout_of_names_made_at(call, &members)
    }

    fn layout_of_created_object(&mut self, call: ExprId, number: CallId) -> LayoutId {
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
        layout
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
