use bun_sema::bind::Parent;
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::hir::{Call, Chain, ExprId, ExprKind};
use smallvec::SmallVec;

use super::{Arguments, Callee, emit_call_of};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, table};
use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, object};

// A call of a built-in that writes out the structure of what it takes makes what the text says.

pub(super) fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    callee: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_expr(file.skip_type_syntax(callee)) {
        Some(Resolved::Builtin(path)) => path.locked_builtin().map(table::canonical_id),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    /// The literal of `Object.defineProperty(object, key, { .. })`. The call alone has it: what it says becomes part of the definition, also where it says constants alone.
    pub(in crate::lower) fn is_written_descriptor(&self, literal: ExprId) -> bool {
        let Parent::Expr(parent) = self.bound.parent_of_expr(literal) else {
            return false;
        };
        let ExprKind::Call(site) = self.hir[parent].kind else {
            return false;
        };
        let site = self.hir[site];
        let takes_descriptor = matches!(
            find_locked_builtin(self, site.callee),
            Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty)
        );
        takes_descriptor
            && matches!(site.chain, Chain::No)
            && self.hir.ids(site.args).nth(2) == Some(literal)
    }

    // An `as` is a conversion of the list, which is then made.
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

    // The elements of an array literal without a hole and without a spread.
    fn find_written_list(&self, list: ExprId) -> Option<SmallVec<[ExprId; 8]>> {
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

    // What flows into a list flows into what the types say that the list holds, whether the list is made or not.
    fn record_flow_into_list(&mut self, list: ExprId) {
        if let Some(literal) = self.find_array_literal(list) {
            self.array_literal_contents(literal);
        }
    }

    // A pair that is shorter than two is read beyond its end.
    fn find_written_pairs(&self, list: ExprId) -> Option<SmallVec<[SmallVec<[ExprId; 8]>; 8]>> {
        let mut pairs = SmallVec::new();
        for pair in self.find_written_list(list)? {
            let pair = self.find_written_list(pair)?;
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
    fn record_flow_into_argument(&mut self, call: ExprId, list: ExprId, holds_lists: bool) {
        self.file.record_flow_into_list(list);
        if holds_lists {
            for pair in self.file.find_written_list(list).unwrap_or_default() {
                self.file.record_flow_into_list(pair);
            }
        }
        let mut unmade = [self.builder.undefined()];
        self.convert_arguments(call, &mut unmade);
    }

    fn lower_rest_of_pair(&mut self, pair: &[ExprId]) {
        for &unread in &pair[2..] {
            self.lower_expression_for_effect(unread);
        }
    }

    // `Object.fromEntries([[key, value], ..])`. A key is converted when its property is defined, behind every expression of the list.
    fn lower_object_from_entries(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let list = self.file.find_only_argument(site)?;
        let pairs = self.file.find_written_pairs(list)?;
        if pairs.is_empty() {
            return None;
        }
        let mut entries: SmallVec<[(PropertyName, ValueId); 8]> = SmallVec::new();
        for pair in &pairs {
            let key = self.lower_computed_key(pair[0]);
            let value = self.lower_expression(pair[1]);
            self.lower_rest_of_pair(pair);
            entries.push((key, value));
        }
        self.record_flow_into_argument(call, list, true);
        self.set_position(self.file.hir[call].pos);

        let mut names: SmallVec<[(PropertyKeyId, ObjectMemberKind); 8]> = SmallVec::new();
        for &(key, _) in &entries {
            if let PropertyName::Constant(key) = key {
                names.push((key, ObjectMemberKind::Field));
            }
        }
        let mut made = if names.len() == entries.len() {
            let layout = self.file.untyped_layout(&names);
            self.begin_object(layout)
        } else {
            self.begin_dictionary()
        };
        for (key, value) in entries {
            self.add_property(&mut made, key, value, None);
        }
        let made = object::finish_object(self, made);
        Some(self.claim_call_result(call, made))
    }

    // `Object.defineProperties(target, Object.getOwnPropertyDescriptors(source))`: nobody but the outer call has the descriptors.
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

        let target = self.lower_expression(target);
        let source = self.lower_expression(source);
        self.set_position(self.file.last_mapped_position(description.callee));
        let describe = BuiltinId::CompilerHelpersDescribeUnlessOrdinary;
        let described = self.emit_locked_call(describe, None, &[source]);

        let mut written = [target, described];
        self.convert_arguments(call, &mut written);
        let [target, described] = written;
        self.set_position(self.file.last_mapped_position(site.callee));
        let define = self.emit_locked_builtin(BuiltinId::CompilerHelpersDefinePropertiesFrom);
        let define = Callee::without_key(define, None, self.file.find_callee_name(site.callee));
        let arguments = Arguments::Values(SmallVec::from_slice(&[target, described, source]));
        let defined = emit_call_of(self, define, arguments);
        self.set_position(hir[call].pos);
        Some(self.claim_call_result(call, defined))
    }

    pub(super) fn try_lower_call(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        if !matches!(site.chain, Chain::No) {
            return None;
        }
        match find_locked_builtin(self.file, site.callee) {
            Some(BuiltinId::ObjectFromEntries) => self.lower_object_from_entries(call, site),
            Some(BuiltinId::ObjectDefineProperties) => {
                self.lower_definition_by_descriptors(call, site)
            }
            Some(BuiltinId::ArrayFrom) => self.lower_array_from(call, site),
            Some(BuiltinId::Object) => self.lower_empty_object(call, site),
            Some(_) => None,
            None => self.try_lower_method_call(call, site),
        }
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

    // `new Map([[key, value], ..])`. A list of constants stays: the whole map is laid into the image.
    fn lower_map_of_entries(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        let list = self.file.find_only_argument(site)?;
        if self.file.is_made_of_constants(list) {
            return None;
        }
        let pairs = self.file.find_written_pairs(list)?;
        let mut entries: SmallVec<[[ValueId; 2]; 8]> = SmallVec::new();
        for pair in &pairs {
            let key = self.lower_expression(pair[0]);
            let value = self.lower_expression(pair[1]);
            self.lower_rest_of_pair(pair);
            entries.push([key, value]);
        }
        self.record_flow_into_argument(expression, list, true);
        let map = self.emit_empty_collection(expression, site, BuiltinId::Map);
        for entry in &entries {
            self.emit_locked_call(BuiltinId::MapPrototypeSet, Some(map), entry);
        }
        self.set_position(self.file.hir[expression].pos);
        Some(self.claim_call_result(expression, map))
    }

    // `new Set([value, ..])`.
    fn lower_set_of_values(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        let list = self.file.find_only_argument(site)?;
        if self.file.is_made_of_constants(list) {
            return None;
        }
        let elements = self.file.find_written_list(list)?;
        let values: SmallVec<[ValueId; 8]> = elements
            .iter()
            .map(|&element| self.lower_expression(element))
            .collect();
        self.record_flow_into_argument(expression, list, false);
        let set = self.emit_empty_collection(expression, site, BuiltinId::Set);
        for &value in &values {
            self.emit_locked_call(BuiltinId::SetPrototypeAdd, Some(set), &[value]);
        }
        self.set_position(self.file.hir[expression].pos);
        Some(self.claim_call_result(expression, set))
    }

    pub(super) fn try_lower_new(&mut self, expression: ExprId, site: Call) -> Option<ValueId> {
        match find_locked_builtin(self.file, site.callee)? {
            BuiltinId::Map => self.lower_map_of_entries(expression, site),
            BuiltinId::Set => self.lower_set_of_values(expression, site),
            BuiltinId::Object => self.lower_empty_object(expression, site),
            _ => None,
        }
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
