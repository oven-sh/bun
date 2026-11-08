use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CodeUnit, Parent};
use bun_sema::check::aot::{IndexKey, IndexSignature, MemberLookup, PositionTypes, ShapeKind};
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, File, FnId, MemberKey, PatKind, Prop, PropId, PropKey,
    PropKind, VarKind, is_proto_setter,
};
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};

use super::{ObjectBuilder, builder};
use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::ir::generated::LimitId;
use crate::lower::member::{GivenName, PropertyName};
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, captures};

#[derive(Copy, Clone)]
struct Dictionary {
    ty: CheckerTypeId,
}

impl FileLowering<'_, '_, '_, '_> {
    fn is_keyed_by_symbols_alone(&mut self, dictionary: CheckerTypeId) -> bool {
        matches!(
            self.queries.index_signatures(dictionary),
            Ok(signatures) if signatures.iter().all(|signature| matches!(signature.key, IndexKey::Symbol))
        )
    }

    fn find_dictionary(&mut self, literal: ExprId) -> Option<Dictionary> {
        if let ExprKind::Object(properties) = self.hir[literal].kind
            && properties.iter().next().is_none()
        {
            return None;
        }
        if let Ok(Some(ty)) = self.queries.contextual_type(literal) {
            if self.is_dictionary_type(ty) {
                return Some(Dictionary { ty });
            }
            if self.object_type_layout(ty).is_some() {
                return None;
            }
        }
        let ty = self.queries.expression_type(literal).ok()?;
        self.is_dictionary_type(ty).then_some(Dictionary { ty })
    }

    fn is_operand_of_builtin(
        &self,
        literal: ExprId,
        position: usize,
        takes: impl Fn(BuiltinId) -> bool,
    ) -> bool {
        let hir = self.hir;
        let mut child = literal;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(child) {
            if hir.type_assertion_operand(parent) == Some(child) {
                child = parent;
                continue;
            }
            let ExprKind::Call(call) = hir[parent].kind else {
                return false;
            };
            let callee = self.skip_type_syntax(hir[call].callee);
            return hir.ids(hir[call].args).nth(position) == Some(child)
                && self
                    .builtins
                    .builtin_of_expression(callee)
                    .is_some_and(takes);
        }
        false
    }

    fn is_map_of_descriptors(&self, literal: ExprId) -> bool {
        self.is_operand_of_builtin(literal, 1, |builtin| {
            matches!(
                builtin,
                BuiltinId::ObjectDefineProperties | BuiltinId::ObjectCreate
            )
        })
    }

    fn is_written_descriptor(&self, literal: ExprId) -> bool {
        self.is_operand_of_builtin(literal, 2, |builtin| {
            matches!(
                builtin,
                BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty
            )
        })
    }

    pub(in crate::lower) fn has_names_known_only_at_run_time(&mut self, source: ExprId) -> bool {
        let names_are_unknown = self
            .queries
            .expression_type(source)
            .and_then(|ty| self.queries.type_shape(ty))
            .is_ok_and(|shape| {
                matches!(
                    shape.kind,
                    ShapeKind::TypeVariable { .. }
                        | ShapeKind::Anything(_)
                        | ShapeKind::AnyObject
                        | ShapeKind::ConstructorFunctionInstance(_)
                )
            });
        if names_are_unknown {
            return true;
        }
        matches!(self.queries.expression_type(source), Ok(ty) if self.is_dictionary_type(ty))
    }

    fn begins_as_copy(&mut self, literal: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let Some(first) = properties.iter().next().map(|first| hir[first]) else {
            return false;
        };
        if first.kind != PropKind::Spread {
            return false;
        }
        if self.has_names_known_only_at_run_time(first.value) {
            return true;
        }
        if properties.len() > 1
            && properties
                .iter()
                .all(|property| hir[property].kind == PropKind::Spread)
        {
            return false;
        }
        let has_object_type = self
            .queries
            .expression_type(literal)
            .and_then(|ty| self.queries.type_shape(ty))
            .is_ok_and(|shape| matches!(shape.kind, ShapeKind::Object));
        if has_object_type {
            return false;
        }
        if self
            .queries
            .is_written_under_type_variable(literal)
            .unwrap_or(false)
        {
            return true;
        }
        let Ok(Some(written)) = self.queries.contextual_type(literal) else {
            return true;
        };
        self.object_type_layout(written).is_none()
    }

    fn is_stored_as_prototype_object(&self, literal: ExprId) -> bool {
        let hir = self.hir;
        if !matches!(hir[literal].kind, ExprKind::Object(_)) {
            return false;
        }
        let named = &self.literals_named_as_prototype_objects;
        if (named.get_or_init(|| self.find_literals_named_as_prototype_objects()))
            .contains(&literal)
        {
            return true;
        }
        let mut child = literal;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(child) {
            if hir.type_assertion_operand(parent) == Some(child) {
                child = parent;
                continue;
            }
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[parent].kind
            else {
                return false;
            };
            return value == child
                && matches!(hir.member_key(target), Some((_, MemberKey::Name(name))) if name == known::prototype);
        }
        false
    }

    fn find_literals_named_as_prototype_objects(&self) -> FxHashSet<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut names: FxHashSet<Binding> = FxHashSet::default();
        for expression in hir.exprs.iter() {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = expression.kind
            else {
                continue;
            };
            let value = hir.skip_type_assertions(value);
            if matches!(hir.member_key(target), Some((_, MemberKey::Name(name))) if name == known::prototype)
                && matches!(hir[value].kind, ExprKind::Ident(_))
                && let binding @ Binding::Symbol(_) = bound.binding(value)
            {
                names.insert(binding);
            }
        }
        let constants = hir.var_decls.iter().filter(|declaration| {
            declaration.kind == VarKind::Const
                && declaration.init != ExprId::NONE
                && matches!(hir[declaration.pat].kind, PatKind::Ident(_))
                && names.contains(&bound.initialized_binding(declaration.pat))
        });
        constants
            .map(|declaration| hir.skip_type_assertions(declaration.init))
            .filter(|&value| matches!(hir[value].kind, ExprKind::Object(_)))
            .collect()
    }

    pub(crate) fn is_built_by_code(&mut self, root: ExprId) -> bool {
        debug_assert!(
            self.decisions().is_data_literal(root),
            "a data literal was expected"
        );
        if self.is_stored_as_prototype_object(root) || self.is_written_descriptor(root) {
            return true;
        }
        let hir = self.hir;
        let deepest = self.inputs.limits.get(LimitId::MaxDataNestingDepth);
        let known = &self.levels_of_literals_inside_built_ones;
        if let Some(&levels) = known.get(&hir.skip_type_assertions(root)) {
            return levels > deepest;
        }
        let mut pending: SmallVec<[(ExprId, u64); 8]> = smallvec![(root, 1)];
        while let Some((expression, depth)) = pending.pop() {
            let literal = hir.skip_type_assertions(expression);
            if !matches!(hir[literal].kind, ExprKind::Array(_) | ExprKind::Object(_)) {
                continue;
            }
            if depth > deepest {
                self.count_levels_of_literals_inside(root);
                return true;
            }
            let inner = |part: ExprId| is_literal(hir, part).then_some((part, depth + 1));
            if let ExprKind::Array(items) = hir[literal].kind {
                pending.extend(hir.ids(items).filter_map(inner));
                continue;
            }
            let ExprKind::Object(properties) = hir[literal].kind else {
                continue;
            };
            if self.find_dictionary(literal).is_some() {
                self.count_levels_of_literals_inside(root);
                return true;
            }
            let values = properties.iter().map(|property| hir[property].value);
            pending.extend(values.filter_map(inner));
        }
        false
    }

    fn count_levels_of_literals_inside(&mut self, root: ExprId) {
        let hir = self.hir;
        let mut found: Vec<(ExprId, usize, u64)> = vec![(hir.skip_type_assertions(root), 0, 1)];
        let mut index = 0;
        while let Some(&(literal, ..)) = found.get(index) {
            let inner = |part: ExprId| {
                is_literal(hir, part).then(|| (hir.skip_type_assertions(part), index, 1))
            };
            match hir[literal].kind {
                ExprKind::Array(items) => found.extend(hir.ids(items).filter_map(inner)),
                ExprKind::Object(_) if self.find_dictionary(literal).is_some() => {
                    found[index].2 = u64::MAX;
                }
                ExprKind::Object(properties) => {
                    let values = properties.iter().map(|property| hir[property].value);
                    found.extend(values.filter_map(inner));
                }
                _ => {}
            }
            index += 1;
        }
        for index in (0..found.len()).rev() {
            let (literal, outer, levels) = found[index];
            if index > 0 {
                found[outer].2 = found[outer].2.max(levels.saturating_add(1));
            }
            if levels > 1 {
                self.levels_of_literals_inside_built_ones
                    .insert(literal, levels);
            }
        }
    }

    fn find_types_under_name(
        &mut self,
        dictionary: CheckerTypeId,
        name: Atom,
    ) -> Option<PositionTypes> {
        match self.queries.find_member(dictionary, name) {
            Ok(MemberLookup::Index(signature)) => Some(signature.types),
            Ok(MemberLookup::Member(_) | MemberLookup::Absent) | Err(_) => None,
        }
    }

    fn find_key_kind(&mut self, key: ExprId) -> Option<IndexKey> {
        let ty = self.queries.expression_type(key).ok()?;
        match self.queries.type_shape(ty).ok()?.kind {
            ShapeKind::String | ShapeKind::StringLiteral(_) | ShapeKind::TemplateLiteral { .. } => {
                Some(IndexKey::String)
            }
            ShapeKind::Number | ShapeKind::NumberLiteral(_) | ShapeKind::NumericEnumMember(_) => {
                Some(IndexKey::Number)
            }
            ShapeKind::Symbol => Some(IndexKey::Symbol),
            _ => None,
        }
    }

    fn find_types_under_key_kind(
        &mut self,
        dictionary: CheckerTypeId,
        key: IndexKey,
    ) -> Option<PositionTypes> {
        let signatures = self.queries.index_signatures(dictionary).ok()?;
        if find_signature(signatures, IndexKey::Pattern).is_some() {
            return None;
        }
        let found = match key {
            IndexKey::Number => find_signature(signatures, IndexKey::Number)
                .or_else(|| find_signature(signatures, IndexKey::String)),
            IndexKey::String | IndexKey::Pattern => find_signature(signatures, IndexKey::String),
            IndexKey::Symbol => find_signature(signatures, IndexKey::Symbol),
        };
        found.map(|signature| signature.types)
    }
}

fn has_only_computed_values(hir: &File<'_>, literal: ExprId) -> bool {
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    properties.iter().all(|property| {
        let prop = hir[property];
        matches!(prop.kind, PropKind::Init)
            && !matches!(hir.runtime_property_key(property), PropKey::Name(_))
    })
}

fn has_only_named_values(hir: &File<'_>, literal: ExprId, allows_methods: bool) -> bool {
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    properties.iter().all(|property| {
        let prop = hir[property];
        let is_value = match prop.kind {
            PropKind::Init | PropKind::Shorthand => true,
            PropKind::Method => allows_methods,
            PropKind::Spread | PropKind::Getter | PropKind::Setter => false,
        };
        is_value
            && !is_proto_setter(&prop)
            && matches!(hir.runtime_property_key(property), PropKey::Name(_))
    })
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn convert_dictionary_member(
        &mut self,
        dictionary: Option<Dictionary>,
        key: PropKey,
        value: ValueId,
        source: ExprId,
    ) -> ValueId {
        let Some(dictionary) = dictionary else {
            return value;
        };
        let file = &mut *self.file;
        let types = match key {
            PropKey::Name(name) => file.find_types_under_name(dictionary.ty, name),
            PropKey::Computed(key) => match file.find_key_kind(key) {
                Some(kind) => file.find_types_under_key_kind(dictionary.ty, kind),
                None => None,
            },
            PropKey::Private(_) | PropKey::None => None,
        };
        let position =
            types.and_then(|types| self.file.find_int32_position(types, types.written, false));
        match position {
            Some(position) => self.convert_initializer(value, position, Some(source)),
            None => value,
        }
    }

    fn lower_spread(
        &mut self,
        object: &mut ObjectBuilder,
        dictionary: Option<Dictionary>,
        source: ExprId,
        position: u32,
    ) {
        let hir = self.file.hir;
        if !ends_in_literal_of_plain_members(self.file, source) {
            let value = self.lower_expression(source);
            self.set_position(position);
            self.add_spread(object, value);
            return;
        }
        match hir[source].kind {
            ExprKind::Object(properties) => {
                for property in properties.iter() {
                    self.lower_property_definition(object, dictionary, property);
                }
            }
            ExprKind::Binary { left, right, .. } => {
                self.finish_head(object);
                let if_true = self.create_block();
                let join = self.create_block();
                self.lower_condition(left, if_true, join);
                self.continue_in(if_true);
                self.lower_spread(object, dictionary, right, position);
                self.define_waiting_elements(object);
                self.jump(join);
                self.continue_in(join);
            }
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                self.finish_head(object);
                let if_true = self.create_block();
                let if_false = self.create_block();
                let join = self.create_block();
                self.lower_condition(test, if_true, if_false);
                self.continue_in(if_true);
                self.lower_spread(object, dictionary, yes, position);
                self.define_waiting_elements(object);
                self.jump(join);
                self.continue_in(if_false);
                self.lower_spread(object, dictionary, no, position);
                self.define_waiting_elements(object);
                self.jump(join);
                self.continue_in(join);
            }
            _ => unreachable!("ends_in_literal_of_plain_members has looked"),
        }
    }

    pub(in crate::lower) fn lower_property_of_written_literal(
        &mut self,
        object: &mut ObjectBuilder,
        property: PropId,
    ) {
        self.lower_property_definition(object, None, property);
    }

    fn lower_property_definition(
        &mut self,
        object: &mut ObjectBuilder,
        dictionary: Option<Dictionary>,
        property: PropId,
    ) {
        let hir = self.file.hir;
        let prop = hir[property];
        let key = hir.runtime_property_key(property);
        self.set_position(prop.pos);
        match prop.kind {
            PropKind::Spread => {
                self.lower_spread(object, dictionary, prop.value, prop.pos);
            }
            PropKind::Init if is_proto_setter(&prop) => {
                let prototype = self.lower_expression(prop.value);
                self.set_position(prop.pos);
                builder::set_prototype(self, object, prototype);
            }
            PropKind::Init | PropKind::Shorthand => {
                let Some(name) = self.try_lower_property_name(key) else {
                    self.lower_taken_value_for_effect(prop.value);
                    return;
                };
                let given = GivenName::under_property(&prop, name);
                let value = self.lower_named_evaluation(prop.value, given);
                self.set_position(prop.pos);
                let value = self.convert_dictionary_member(dictionary, key, value, prop.value);
                self.add_property(object, name, value, Some(prop.value));
            }
            PropKind::Method => {
                let Some(name) = self.try_lower_property_name(key) else {
                    return;
                };
                self.set_position(prop.pos);
                let function = get_method_function(hir, &prop);
                let function_key = self.file.scopes.function_key(CodeUnit::Function(function));
                let captures_home = captures::captures_home_object(self.file, function_key);
                let home = captures_home.then(|| self.open_head(object));
                let given = GivenName::under_property(&prop, name);
                let closure = self.create_named_closure(function, Some(given), home);
                let closure = self.convert_dictionary_member(dictionary, key, closure, prop.value);
                self.add_property(object, name, closure, Some(prop.value));
            }
            PropKind::Getter | PropKind::Setter => {
                let Some(name) = self.try_lower_property_name(key) else {
                    return;
                };
                self.set_position(prop.pos);
                self.define_waiting_elements(object);
                let head = self.open_head(object);
                let function = get_method_function(hir, &prop);
                let given = GivenName::under_property(&prop, name);
                let closure = self.lower_method(function, given, head);
                let (computed_key, constant_key) = name.key_operands();
                if let Some(key) = constant_key {
                    self.file.fragment.note_write(key);
                }
                if prop.kind == PropKind::Getter {
                    self.builder
                        .define_getter(head, closure, computed_key, constant_key);
                } else {
                    self.builder
                        .define_setter(head, closure, computed_key, constant_key);
                }
            }
        }
    }

    fn try_lower_property_name(&mut self, key: PropKey) -> Option<PropertyName> {
        match key {
            PropKey::Name(_) | PropKey::Computed(_) => Some(self.lower_property_name(key)),
            PropKey::Private(_) | PropKey::None => None,
        }
    }
}

fn get_method_function(hir: &File<'_>, prop: &Prop) -> FnId {
    let ExprKind::Fn(function) = hir[prop.value].kind else {
        unreachable!("the value of a method, getter or setter is a function");
    };
    function
}

pub(in crate::lower) fn is_born_level_by_level(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> bool {
    if lowering.is_module_body() && !lowering.stands_in_loop() {
        return false;
    }
    let hir = lowering.file.hir;
    if lowering.only_argument_of_construction == Some(hir.skip_type_assertions(literal)) {
        return false;
    }
    let literal = hir.skip_type_assertions(literal);
    let mut known = lowering.lists_inside_literals.borrow_mut();
    if !known.contains_key(&literal) && is_laid_out_in_line_by_the_walk(hir, literal) {
        known.insert(literal, ListsInside::None);
    }
    let mut pending: SmallVec<[(ExprId, bool); 8]> = smallvec![(literal, false)];
    while let Some((expression, is_left)) = pending.pop() {
        if known.contains_key(&expression) {
            continue;
        }
        let inside = find_literals_inside(hir, expression);
        if !is_left && !inside.is_empty() {
            pending.push((expression, true));
            pending.extend(inside.iter().map(|&inner| (inner, false)));
            continue;
        }
        let is_filled_list =
            matches!(hir[expression].kind, ExprKind::Array(items) if items.len() != 0);
        let lists = match inside.iter().any(|inner| known[inner] != ListsInside::None) {
            true => ListsInside::Some,
            false if inside.is_empty() && is_filled_list => ListsInside::IsListOfLeaves,
            false => ListsInside::None,
        };
        known.insert(expression, lists);
    }
    known[&literal] == ListsInside::Some
}

fn is_laid_out_in_line_by_the_walk(hir: &File<'_>, literal: ExprId) -> bool {
    const MOST_NODES_OF_EXPANDED_DATA: usize = 16;
    let mut number_of_nodes = 1;
    let mut pending: SmallVec<[ExprId; 8]> = smallvec![literal];
    while let Some(list) = pending.pop() {
        let ExprKind::Array(items) = hir[list].kind else {
            return false;
        };
        number_of_nodes += items.len();
        if number_of_nodes > MOST_NODES_OF_EXPANDED_DATA {
            return false;
        }
        pending.extend(find_literals_inside(hir, list));
    }
    true
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::lower) enum ListsInside {
    None,
    IsListOfLeaves,
    Some,
}

fn find_literals_inside(hir: &File<'_>, literal: ExprId) -> SmallVec<[ExprId; 8]> {
    let as_literal = |expression: ExprId| {
        let expression = hir.skip_type_assertions(expression);
        is_literal(hir, expression).then_some(expression)
    };
    match hir[literal].kind {
        ExprKind::Array(items) => hir.ids(items).filter_map(as_literal).collect(),
        ExprKind::Object(properties) => {
            let values = properties.iter().map(|property| hir[property].value);
            values.filter_map(as_literal).collect()
        }
        _ => SmallVec::new(),
    }
}

fn is_literal(hir: &File<'_>, expression: ExprId) -> bool {
    matches!(
        hir[hir.skip_type_assertions(expression)].kind,
        ExprKind::Array(_) | ExprKind::Object(_)
    )
}

fn find_signature(signatures: &[IndexSignature], key: IndexKey) -> Option<IndexSignature> {
    signatures
        .iter()
        .copied()
        .find(|signature| signature.key == key)
}

pub(in crate::lower) fn is_empty_without_prototype(hir: &File<'_>, literal: ExprId) -> bool {
    let ExprKind::Object(props) = hir[literal].kind else {
        return false;
    };
    if props.len() != 1 {
        return false;
    }
    let prop = hir[props.at(0)];
    prop.kind == PropKind::Init
        && is_proto_setter(&prop)
        && matches!(
            hir[hir.skip_type_assertions(prop.value)].kind,
            ExprKind::Null
        )
}

pub(crate) fn lower_object_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Object(props) = hir[literal].kind else {
        unreachable!("lower_object_literal takes an Object expression");
    };
    if is_empty_without_prototype(hir, literal) {
        lowering.set_position(hir[literal].pos);
        if let Some(made) = lowering.lower_literal_below_null_for_maker(literal) {
            return made;
        }
        let null = lowering.builder.null();
        return lowering.emit_builtin_call(BuiltinId::ObjectCreate, &[null]);
    }
    if lowering.file.decisions().is_data_literal(literal)
        && !is_born_level_by_level(lowering, literal)
        && !lowering.file.is_built_by_code(literal)
    {
        return lowering.lower_decided_data(literal);
    }
    let is_prototype_object = lowering.file.is_stored_as_prototype_object(literal);
    let is_copy = !is_prototype_object && lowering.file.begins_as_copy(literal);
    let dictionary = if is_copy {
        None
    } else {
        lowering.file.find_dictionary(literal)
    };
    let mut rest = props.iter();
    let mut object = match dictionary {
        Some(_)
            if has_only_named_values(hir, literal, true)
                && !lowering.file.is_map_of_descriptors(literal) =>
        {
            let layout = lowering.file.literal_layout(literal);
            let fragment = &mut lowering.file.fragment;
            fragment.note_literal_under_dictionary_type(layout);
            let mut object = lowering.begin_object(layout);
            lowering.open_head(&mut object);
            object
        }
        Some(found)
            if lowering.file.is_keyed_by_symbols_alone(found.ty)
                || has_only_computed_values(hir, literal) =>
        {
            let layout = lowering.file.literal_layout(literal);
            lowering.begin_object(layout)
        }
        Some(_) => lowering.begin_dictionary(),
        None if is_prototype_object => lowering.begin_dictionary(),
        None if is_copy => {
            let first = hir[rest.next().expect("a literal that begins with a spread")];
            lowering.set_position(first.pos);
            let source = lowering.lower_expression(first.value);
            lowering.set_position(hir[literal].pos);
            lowering.begin_copy(source)
        }
        None => {
            let layout = lowering.file.literal_layout(literal);
            let mut object = lowering.begin_object(layout);
            if lowering.file.is_opened_at_once(literal) {
                lowering.open_head(&mut object);
            }
            object
        }
    };
    for prop in rest {
        lowering.lower_property_definition(&mut object, dictionary, prop);
    }
    lowering.set_position(hir[literal].pos);
    super::finish_object(lowering, object)
}

fn ends_in_literal_of_plain_members(file: &FileLowering<'_, '_, '_, '_>, source: ExprId) -> bool {
    let hir = file.hir;
    if file.is_statically_resolved(source) || file.is_simplified(source) {
        return false;
    }
    let is_dead = |arm: ExprId| file.decisions().is_dead_expr(arm);
    match hir[source].kind {
        ExprKind::Object(_) => has_only_named_values(hir, source, false),
        ExprKind::Binary {
            op: BinOp::And,
            right,
            ..
        } => !is_dead(right) && ends_in_literal_of_plain_members(file, right),
        ExprKind::Cond { branches, .. } => {
            let Branches { yes, no } = hir.branches(branches);
            !is_dead(yes)
                && !is_dead(no)
                && (ends_in_literal_of_plain_members(file, yes)
                    || ends_in_literal_of_plain_members(file, no))
        }
        _ => false,
    }
}
