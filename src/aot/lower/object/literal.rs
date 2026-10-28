use bun_sema::atom::{Atom, known};
use bun_sema::bind::{CodeUnit, Parent};
use bun_sema::check::aot::{
    IndexKey, IndexSignature, MemberLookup, MemberName, PositionTypes, ShapeKind,
};
use bun_sema::check::spans::skip_trivia_back;
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, File, FnId, MemberKey, Prop, PropId, PropKey, PropKind,
    is_proto_setter, start_of,
};
use smallvec::{SmallVec, smallvec};

use super::{ObjectBuilder, builder};
use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::ir::generated::TypeSiteKind;
use crate::lower::member::{GivenName, PropertyName};
use crate::lower::positions::SiteOrigin;
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, captures, convert};

/// What stands in front of a property of a literal.
#[derive(Copy, Clone)]
enum InFront {
    StartOfLiteral(u32),
    Property(PropId),
}

#[derive(Copy, Clone)]
struct Dictionary {
    ty: CheckerTypeId,
    position: u32,
}

impl FileLowering<'_, '_, '_, '_> {
    // The types are asked in the order in which a literal finds its layout: the type it is written under, then its own.
    fn find_dictionary(&mut self, literal: ExprId) -> Option<Dictionary> {
        if let ExprKind::Object(properties) = self.hir[literal].kind
            && properties.iter().next().is_none()
        {
            return None;
        }
        let position = self.hir[literal].pos;
        if let Ok(Some(ty)) = self.queries.contextual_type(literal) {
            if self.is_dictionary_type(ty) {
                return Some(Dictionary { ty, position });
            }
            if self.object_type_layout(ty).is_some() {
                return None;
            }
        }
        let ty = self.queries.expression_type(literal).ok()?;
        self.is_dictionary_type(ty)
            .then_some(Dictionary { ty, position })
    }

    // `Object.defineProperties(target, { .. })`, `Object.create(base, { .. })`: the built-in takes the literal as a map, name by name, and nobody else sees it.
    fn is_map_of_descriptors(&self, literal: ExprId) -> bool {
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
            return hir.ids(hir[call].args).nth(1) == Some(child)
                && matches!(
                    self.builtins.builtin_of_expression(callee),
                    Some(BuiltinId::ObjectDefineProperties | BuiltinId::ObjectCreate)
                );
        }
        false
    }

    // `{ ...source, a }` where no type says which names the object will have.
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
        let names_of_source_are_unknown = self
            .queries
            .expression_type(first.value)
            .and_then(|ty| self.queries.type_shape(ty))
            .is_ok_and(|shape| {
                matches!(
                    shape.kind,
                    ShapeKind::TypeVariable { .. } | ShapeKind::Anything(_) | ShapeKind::AnyObject
                )
            });
        if names_of_source_are_unknown {
            return true;
        }
        // `{ ...defaults, ...options }`: an object of its own kind, which holds the names of every source.
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

    // `Point.prototype = { .. }`: the run time watches the members of a class on an ordinary object alone.
    fn is_stored_as_prototype_object(&self, literal: ExprId) -> bool {
        let hir = self.hir;
        if !matches!(hir[literal].kind, ExprKind::Object(_)) {
            return false;
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

    pub(crate) fn holds_dictionary_literal(&mut self, root: ExprId) -> bool {
        debug_assert!(
            self.decisions().is_data_literal(root),
            "a data literal was expected"
        );
        if self.is_stored_as_prototype_object(root) || self.is_written_descriptor(root) {
            return true;
        }
        let hir = self.hir;
        let mut pending: SmallVec<[ExprId; 8]> = smallvec![root];
        while let Some(expression) = pending.pop() {
            let literal = hir.skip_type_assertions(expression);
            if let ExprKind::Array(items) = hir[literal].kind {
                pending.extend(hir.ids(items).filter(|&item| is_literal(hir, item)));
                continue;
            }
            let ExprKind::Object(properties) = hir[literal].kind else {
                continue;
            };
            if self.find_dictionary(literal).is_some() {
                return true;
            }
            let values = properties.iter().map(|property| hir[property].value);
            pending.extend(values.filter(|&value| is_literal(hir, value)));
        }
        false
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

    // Which pattern a key matches depends on its text, so beside a pattern nothing is said about a key that has only a kind.
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

    fn record_flow_into_signature(
        &mut self,
        copied: PositionTypes,
        signature: Option<PositionTypes>,
        position: u32,
    ) {
        if let (Ok(copied), Some(Ok(held))) = (copied.checked, signature.map(|types| types.checked))
        {
            self.record_type_flow(copied, held, position);
        }
    }
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
    // A member of the literal is converted like the value of `dictionary[key] = value`.
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
        let Some(types) = types else {
            return value;
        };
        let origin = SiteOrigin {
            kind: TypeSiteKind::Element,
            position: dictionary.position,
        };
        let position = self.file.create_position(types, origin);
        let subject = convert::Int32Subject::LiteralProperty;
        self.describe_int32_flow(position, subject, Some(source));
        self.convert_initializer(value, position, Some(source))
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
            record_spread_flow(self.file, dictionary, source);
            self.add_spread(object, value);
            return;
        }
        match hir[source].kind {
            ExprKind::Object(properties) => {
                let mut in_front = InFront::StartOfLiteral(hir[source].pos);
                for property in properties.iter() {
                    self.lower_property_definition(object, dictionary, property, in_front);
                    in_front = InFront::Property(property);
                }
            }
            ExprKind::Binary { left, right, .. } => {
                self.finish_head(object);
                let if_true = self.create_block();
                let join = self.create_block();
                self.lower_condition(left, if_true, join);
                self.continue_in(if_true);
                self.lower_spread(object, dictionary, right, position);
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
                self.jump(join);
                self.continue_in(if_false);
                self.lower_spread(object, dictionary, no, position);
                self.jump(join);
                self.continue_in(join);
            }
            _ => unreachable!("ends_in_literal_of_plain_members has looked"),
        }
    }

    fn lower_property_definition(
        &mut self,
        object: &mut ObjectBuilder,
        dictionary: Option<Dictionary>,
        property: PropId,
        in_front: InFront,
    ) {
        let hir = self.file.hir;
        let prop = hir[property];
        let key = hir.runtime_property_key(property);
        self.set_position(prop.pos);
        match prop.kind {
            // JSC copies the object that a literal begins with in one step, which it reports at the start of the literal.
            PropKind::Spread => {
                let (position, recorded) = match in_front {
                    InFront::StartOfLiteral(start) => (start, start),
                    InFront::Property(_) if self.file.runs_as_written() => {
                        let value = start_of(hir, prop.value) as usize;
                        let end_of_dots = skip_trivia_back(&hir.text, value) as u32;
                        (end_of_dots, end_of_dots)
                    }
                    // The source map does not know the parenthesis and answers the token in front of it.
                    InFront::Property(previous)
                        if self.file.begins_with_parenthesis(prop.value) =>
                    {
                        let last = self.file.last_mapped_value_position(hir[previous].value);
                        (last, last)
                    }
                    InFront::Property(_) => (prop.pos, self.file.first_position(prop.value)),
                };
                self.lower_spread(object, dictionary, prop.value, position);
                self.builder.record_position(recorded);
            }
            PropKind::Init if is_proto_setter(&prop) => {
                let prototype = self.lower_expression(prop.value);
                self.set_position(prop.pos);
                builder::set_prototype(self, object, prototype);
            }
            PropKind::Init | PropKind::Shorthand => {
                let Some(name) = self.try_lower_property_name(key) else {
                    self.lower_expression_for_effect(prop.value);
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

// What is read out of the dictionary is tested against the type of its index signature, so what a spread copies into it goes into the family of that type.
fn record_spread_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    dictionary: Option<Dictionary>,
    source: ExprId,
) {
    let Some(dictionary) = dictionary else {
        return;
    };
    let Ok(copied) = file.queries.expression_type(source) else {
        return;
    };
    let Ok(copied) = file.queries.without_nullish(copied) else {
        return;
    };
    if copied == dictionary.ty {
        return;
    }
    let position = file.hir[source].pos;
    if let Ok(members) = file.queries.object_members(copied) {
        for member in members {
            if let MemberName::String(name) = member.name {
                let signature = file.find_types_under_name(dictionary.ty, name);
                file.record_flow_into_signature(member.types, signature, position);
            }
        }
    }
    if let Ok(signatures) = file.queries.index_signatures(copied) {
        for copied_signature in signatures {
            let signature = file.find_types_under_key_kind(dictionary.ty, copied_signature.key);
            file.record_flow_into_signature(copied_signature.types, signature, position);
        }
    }
}

// `{ __proto__: null }` and nothing else.
fn is_empty_without_prototype(hir: &File<'_>, literal: ExprId) -> bool {
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
    // What Object.create(null) makes: the object is born without a prototype and nothing takes one away from it.
    if is_empty_without_prototype(hir, literal) {
        lowering.set_position(hir[literal].pos);
        let null = lowering.builder.null();
        return lowering.emit_builtin_call(BuiltinId::ObjectCreate, &[null]);
    }
    if lowering.file.decisions().is_data_literal(literal)
        && !lowering.file.holds_dictionary_literal(literal)
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
        // `const levels: Record<string, number> = { debug: 0, info: 1 }`: the type allows any name, and the names that the object has are written.
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
            lowering.begin_object(layout)
        }
    };
    let mut in_front = match props.iter().next() {
        Some(first) if rest.len() != props.len() => InFront::Property(first),
        _ => InFront::StartOfLiteral(hir[literal].pos),
    };
    let mut members: SmallVec<[(PropId, InFront); 8]> = SmallVec::new();
    for prop in rest {
        members.push((prop, in_front));
        in_front = InFront::Property(prop);
    }
    put_halves_of_accessors_side_by_side(lowering.file, &mut members);
    for (prop, in_front) in members {
        lowering.lower_property_definition(&mut object, dictionary, prop, in_front);
    }
    lowering.set_position(hir[literal].pos);
    super::finish_object(lowering, object)
}

// Making a function runs no code and nobody has seen the object yet, so nobody can tell where a half is made, and the name keeps the place of its first definition among the keys either way.
fn put_halves_of_accessors_side_by_side(
    file: &FileLowering<'_, '_, '_, '_>,
    members: &mut [(PropId, InFront)],
) {
    let hir = file.hir;
    let find_half = |member: &(PropId, InFront)| {
        let prop = hir[member.0];
        let is_half = matches!(prop.kind, PropKind::Getter | PropKind::Setter);
        is_half.then(|| get_method_function(hir, &prop))
    };
    for index in 0..members.len() {
        let Some(half) = find_half(&members[index]) else {
            continue;
        };
        let key = file.scopes.function_key(CodeUnit::Function(half));
        let Some(in_front) = file.scopes.half_to_stand_behind(key) else {
            continue;
        };
        let is_in_front = |member: &(PropId, InFront)| find_half(member) == Some(in_front);
        let found = members[..index].iter().rposition(is_in_front);
        let place = found.expect("the half in front stands in the same literal") + 1;
        members[place..=index].rotate_right(1);
    }
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
