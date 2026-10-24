use bstr::{BStr, BString};
use bun_sema::check::aot::{AnythingReason, ShapeKind};

use super::{ROOT, placeholder_of};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{
    ExpectedResult, TemplatePart, TemplatePlaceholder, TextFormat, UndeclaredMembers,
    ValidatedPrimitive, ValidationMember, ValidationNode, ValidationRule, ValidationShape,
};
use crate::ir::{PropertyKeyId, StringId};
use crate::lower::validate::misuse::tests::{
    HEADER, collect_diagnostics, lower_main, unsupported_arguments,
};
use crate::lower::{Fragment, LoweredFile};
use crate::statistics::{LimitId, LimitValues};

const TEXT_DECLARATION: &str = "declare const text: string;\n";

fn probe_source(declarations: &str, ty: &str) -> String {
    format!("{TEXT_DECLARATION}{declarations}\nexport const probe = JSON.parse<{ty}>(text);\n")
}

fn lower_probe(declarations: &str, ty: &str) -> LoweredFile {
    let body = probe_source(declarations, ty);
    lower_main(&format!("{HEADER}{body}"))
}

fn expected_result_of(declarations: &str, ty: &str) -> (Fragment, ExpectedResult) {
    let lowered = lower_probe(declarations, ty);
    let diagnostics = collect_diagnostics(&lowered);
    assert!(diagnostics.is_empty(), "{ty}: {diagnostics:?}");
    let mut fragment = lowered.fragment;
    assert_eq!(fragment.expected_results.len(), 1, "{ty}");
    let expected = fragment.expected_results.remove(0);
    assert!(!expected.validation.is_empty(), "{ty}");
    (fragment, expected)
}

fn nodes_of(declarations: &str, ty: &str) -> (Fragment, Vec<ValidationNode>) {
    let (fragment, expected) = expected_result_of(declarations, ty);
    (fragment, expected.validation)
}

fn unsupported_part(declarations: &str, ty: &str) -> BString {
    let mut arguments = unsupported_arguments(&probe_source(declarations, ty));
    assert_eq!(arguments.len(), 3, "{ty}");
    arguments.remove(2)
}

fn text_of(fragment: &Fragment, id: StringId) -> &BStr {
    BStr::new(fragment.strings.get(id))
}

fn key_text(fragment: &Fragment, key: PropertyKeyId) -> &BStr {
    let text = fragment.property_keys.get(key).text;
    text_of(fragment, text.expect("the key of a member is a text"))
}

fn find_string(fragment: &Fragment, text: &str) -> StringId {
    let found = fragment.strings.find(text.as_bytes());
    found.unwrap_or_else(|| panic!("the fragment has no string {text:?}"))
}

fn shape_of(nodes: &[ValidationNode], node: u32) -> &ValidationShape {
    &nodes[node as usize].shape
}

fn members_of(nodes: &[ValidationNode], node: u32) -> &[ValidationMember] {
    let ValidationShape::Object { members, .. } = shape_of(nodes, node) else {
        panic!("node {node} is {:?}", shape_of(nodes, node));
    };
    members
}

fn undeclared_of(nodes: &[ValidationNode], node: u32) -> UndeclaredMembers {
    let ValidationShape::Object { undeclared, .. } = shape_of(nodes, node) else {
        panic!("node {node} is {:?}", shape_of(nodes, node));
    };
    *undeclared
}

fn find_member(
    fragment: &Fragment,
    nodes: &[ValidationNode],
    node: u32,
    name: &str,
) -> ValidationMember {
    let mut members = members_of(nodes, node).iter();
    let found = members.find(|member| key_text(fragment, member.key) == name);
    *found.unwrap_or_else(|| panic!("node {node} has no member {name}"))
}

fn primitive(primitive: ValidatedPrimitive) -> ValidationShape {
    ValidationShape::Primitive { primitive }
}

fn count_node_limit_losses(lowered: &LoweredFile) -> u32 {
    let losses = lowered.counters.losses().iter();
    losses
        .filter(|loss| loss.limit == LimitId::MaxValidationNodes)
        .map(|loss| loss.count)
        .sum()
}

#[test]
fn root_is_node_zero() {
    let (fragment, nodes) = nodes_of("", "{ a: number }");
    assert_eq!(nodes.len(), 2);
    let [member] = members_of(&nodes, ROOT) else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(key_text(&fragment, member.key), "a");
    assert_eq!(member.node, 1);
    assert_eq!(nodes[1].shape, primitive(ValidatedPrimitive::Number));
    assert_eq!(undeclared_of(&nodes, ROOT), UndeclaredMembers::Allowed);
}

#[test]
fn members_keep_declared_order() {
    let (fragment, nodes) = nodes_of("", "{ b: string; a: number; c?: boolean }");
    let members = members_of(&nodes, ROOT);
    let keys: Vec<&BStr> = members
        .iter()
        .map(|member| key_text(&fragment, member.key))
        .collect();
    let optional: Vec<bool> = members.iter().map(|member| member.is_optional).collect();
    assert_eq!(keys, ["b", "a", "c"]);
    assert_eq!(optional, [false, false, true]);
    let last = shape_of(&nodes, members[2].node);
    assert_eq!(*last, primitive(ValidatedPrimitive::Boolean));
}

#[test]
fn members_name_layout_fields() {
    let declarations = "interface Point { x: number; y: number }";
    let (_, expected) = expected_result_of(declarations, "Point");
    let ValidationShape::Object {
        layout: Some(layout),
        members,
        ..
    } = &expected.validation[0].shape
    else {
        panic!("{:?}", expected.validation[0].shape);
    };
    let fields: Vec<Option<u32>> = members.iter().map(|member| member.field).collect();
    let [Some(first), Some(second)] = fields[..] else {
        panic!("{fields:?}");
    };
    assert_ne!(first, second);
    assert!(expected.layouts.contains(layout));
}

#[test]
fn object_type_has_display_name() {
    let (fragment, nodes) = nodes_of("interface Point { x: number }", "{ at: Point }");
    let at = find_member(&fragment, &nodes, ROOT, "at");
    let name = nodes[at.node as usize].text;
    assert_eq!(
        name.map(|name| text_of(&fragment, name)),
        Some(BStr::new("Point"))
    );
    let x = find_member(&fragment, &nodes, at.node, "x");
    assert_eq!(nodes[x.node as usize].text, None);
}

#[test]
fn leaf_types_have_leaf_shapes() {
    let declarations = r#"enum Color { Red = 2, Blue = 3 }
        interface Leaves {
            text: string;
            count: number;
            flag: boolean;
            wide: bigint;
            nothing: null;
            missing: undefined;
            impossible: never;
            reference: object;
            yes: true;
            one: 1;
            word: "x";
            color: Color.Red;
            anything: any;
            unchecked: unknown;
        }"#;
    let (fragment, nodes) = nodes_of(declarations, "Leaves");
    let word = find_string(&fragment, "x");
    let expected = [
        ("text", primitive(ValidatedPrimitive::String)),
        ("count", primitive(ValidatedPrimitive::Number)),
        ("flag", primitive(ValidatedPrimitive::Boolean)),
        ("wide", primitive(ValidatedPrimitive::BigInt)),
        ("nothing", ValidationShape::Null),
        ("missing", ValidationShape::Undefined),
        ("impossible", ValidationShape::Never),
        ("reference", ValidationShape::AnyObject),
        ("yes", ValidationShape::BooleanLiteral { value: true }),
        ("one", ValidationShape::NumberLiteral { value: 1.0 }),
        ("word", ValidationShape::StringLiteral { value: word }),
        ("color", ValidationShape::NumberLiteral { value: 2.0 }),
        ("anything", ValidationShape::Unknown),
        ("unchecked", ValidationShape::Unknown),
    ];
    for (name, shape) in expected {
        let member = find_member(&fragment, &nodes, ROOT, name);
        assert_eq!(*shape_of(&nodes, member.node), shape, "{name}");
    }
}

#[test]
fn empty_object_type_has_no_layout() {
    let (fragment, nodes) = nodes_of("", "{ a: {} }");
    let a = find_member(&fragment, &nodes, ROOT, "a");
    assert_eq!(
        *shape_of(&nodes, a.node),
        ValidationShape::Object {
            layout: None,
            members: Vec::new(),
            undeclared: UndeclaredMembers::Allowed,
            undeclared_value: None,
        }
    );
}

#[test]
fn constraints_become_rules() {
    let declarations = r#"interface Rules {
            whole: number & Schema.Int;
            ranged: number & Schema.Min<1> & Schema.Max<9>;
            reversed: number & Schema.Max<9> & Schema.Min<1>;
            open: number & Schema.Above<0> & Schema.Below<1>;
            stepped: number & Schema.MultipleOf<5>;
            sized: string & Schema.MinLength<1> & Schema.MaxLength<8>;
            listed: string[] & Schema.MinItems<1> & Schema.MaxItems<3>;
            matched: string & Schema.Pattern<"^a">;
            formatted: string & Schema.Format<"uuid">;
            explained: number & Schema.Min<1> & Schema.Message<"too small">;
            port: number & Schema.Default<8080>;
            host: string & Schema.Default<"localhost">;
            small: int32;
            plain: number;
        }"#;
    let (fragment, nodes) = nodes_of(declarations, "Rules");
    let string = |text: &str| find_string(&fragment, text);
    let minimum = |bound: f64| ValidationRule::Minimum { bound };
    let maximum = |bound: f64| ValidationRule::Maximum { bound };
    let minimum_length = |length: u32| ValidationRule::MinimumLength { length };
    let maximum_length = |length: u32| ValidationRule::MaximumLength { length };
    let open_range = vec![
        ValidationRule::ExclusiveMinimum { bound: 0.0 },
        ValidationRule::ExclusiveMaximum { bound: 1.0 },
    ];
    let pattern = ValidationRule::Pattern {
        source: string("^a"),
    };
    let format = ValidationRule::Format {
        format: TextFormat::Uuid,
    };
    let message = ValidationRule::Message {
        text: string("too small"),
    };
    let default_host = ValidationRule::DefaultString {
        value: string("localhost"),
    };
    let int32_range = vec![
        ValidationRule::Integer,
        minimum(-2147483648.0),
        maximum(2147483647.0),
    ];
    let expected = [
        ("whole", vec![ValidationRule::Integer]),
        ("ranged", vec![minimum(1.0), maximum(9.0)]),
        ("reversed", vec![maximum(9.0), minimum(1.0)]),
        ("open", open_range),
        ("stepped", vec![ValidationRule::MultipleOf { divisor: 5.0 }]),
        ("sized", vec![minimum_length(1), maximum_length(8)]),
        ("listed", vec![minimum_length(1), maximum_length(3)]),
        ("matched", vec![pattern]),
        ("formatted", vec![format]),
        ("explained", vec![minimum(1.0), message]),
        (
            "port",
            vec![ValidationRule::DefaultNumber { value: 8080.0 }],
        ),
        ("host", vec![default_host]),
        ("small", int32_range),
        ("plain", Vec::new()),
    ];
    for (name, rules) in expected {
        let member = find_member(&fragment, &nodes, ROOT, name);
        assert_eq!(nodes[member.node as usize].rules, rules, "{name}");
    }
}

#[test]
fn invalid_schema_arguments_are_refused_and_counted() {
    let types = [
        "number & Schema.Min<number>",
        "string & Schema.MinLength<-1>",
        r#"string & Schema.Format<"email" | "uuid">"#,
        "number & Schema.Int & Schema.Max<number>",
    ];
    for ty in types {
        let declarations = format!("interface Rules {{ member: {ty} }}");
        let lowered = lower_probe(&declarations, "Rules");
        assert_eq!(lowered.queries.invalid_schema_arguments, 1, "{ty}");
        assert_is_refused(&lowered, ty);
    }
}

fn assert_is_refused(lowered: &LoweredFile, ty: &str) {
    let codes: Vec<Code> = collect_diagnostics(lowered)
        .into_iter()
        .map(|(code, _)| code)
        .collect();
    assert_eq!(codes, [Code::UnsupportedValidationType], "{ty}");
    assert!(lowered.fragment.expected_results.is_empty(), "{ty}");
}

#[test]
fn schema_alias_that_is_no_longer_as_written_is_refused() {
    let declarations = "type Writable<T> = { -readonly [K in keyof T]: T[K] };";
    let types = [
        "Writable<{ readonly id: number } & Schema.Strict>",
        "Partial<{ id: number } & Schema.Strict>",
        "Required<{ id?: number } & Schema.Strict>",
        "string & Readonly<Schema.MinLength<8>>",
        "number & Partial<Schema.Min<0>>",
        r#"string & { readonly "bun.minLength"?: 8 }"#,
        "{ member: Schema.MinLength<3> }",
        "Schema.Min<1>",
    ];
    for ty in types {
        assert_is_refused(&lower_probe(declarations, ty), ty);
    }
}

#[test]
fn brand_of_program_beside_primitive_is_validated() {
    let (_, nodes) = nodes_of("", r#"string & { readonly __brand?: "id" }"#);
    assert_eq!(
        nodes[ROOT as usize].shape,
        ValidationShape::Primitive {
            primitive: ValidatedPrimitive::String
        }
    );
}

#[test]
fn valid_schema_arguments_are_not_counted_as_dropped() {
    let declarations = r#"interface Rules {
            ranged: number & Schema.Min<1>;
            sized: string & Schema.MinLength<0>;
            formatted: string & Schema.Format<"email">;
            plain: number;
        }"#;
    let lowered = lower_probe(declarations, "Rules");
    assert_eq!(lowered.queries.invalid_schema_arguments, 0);
}

#[test]
fn constrained_type_has_base_shape() {
    let ty = "{ count: number & Schema.Int; tags: string[] & Schema.MinItems<1> }";
    let (fragment, nodes) = nodes_of("", ty);
    let count = find_member(&fragment, &nodes, ROOT, "count");
    let tags = find_member(&fragment, &nodes, ROOT, "tags");
    assert_eq!(
        *shape_of(&nodes, count.node),
        primitive(ValidatedPrimitive::Number)
    );
    let ValidationShape::Array { element } = *shape_of(&nodes, tags.node) else {
        panic!("{:?}", shape_of(&nodes, tags.node));
    };
    assert_eq!(
        *shape_of(&nodes, element),
        primitive(ValidatedPrimitive::String)
    );
}

#[test]
fn strict_rejects_undeclared_members() {
    let (fragment, nodes) = nodes_of("", "{ a: { b: number } } & Schema.Strict");
    let nested = find_member(&fragment, &nodes, ROOT, "a");
    assert_eq!(undeclared_of(&nodes, ROOT), UndeclaredMembers::Rejected);
    assert_eq!(
        undeclared_of(&nodes, nested.node),
        UndeclaredMembers::Allowed
    );
}

#[test]
fn deep_strict_reaches_nested_objects() {
    let declarations = "interface Inner { v: number; u: undefined }";
    let ty = "{ strict: { inner: Inner } & Schema.DeepStrict; loose: Inner }";
    let (fragment, nodes) = nodes_of(declarations, ty);
    let member = |node: u32, name: &str| find_member(&fragment, &nodes, node, name).node;
    let strict = member(ROOT, "strict");
    let strict_inner = member(strict, "inner");
    let loose_inner = member(ROOT, "loose");
    assert_eq!(undeclared_of(&nodes, ROOT), UndeclaredMembers::Allowed);
    assert_eq!(undeclared_of(&nodes, strict), UndeclaredMembers::Rejected);
    assert_eq!(
        undeclared_of(&nodes, strict_inner),
        UndeclaredMembers::Rejected
    );
    assert_eq!(
        undeclared_of(&nodes, loose_inner),
        UndeclaredMembers::Allowed
    );
    assert_ne!(strict_inner, loose_inner);
    assert_ne!(member(strict_inner, "v"), member(loose_inner, "v"));
    assert_eq!(member(strict_inner, "u"), member(loose_inner, "u"));
}

#[test]
fn index_signature_is_dictionary() {
    for ty in ["{ [key: string]: number }", "Record<string, number>"] {
        let (_, nodes) = nodes_of("", ty);
        let ValidationShape::Dictionary { value } = nodes[0].shape else {
            panic!("{ty}: {:?}", nodes[0].shape);
        };
        let number = primitive(ValidatedPrimitive::Number);
        assert_eq!(*shape_of(&nodes, value), number, "{ty}");
    }
}

#[test]
fn index_signature_beside_members_validates_undeclared_members() {
    let (fragment, nodes) = nodes_of("", "{ a: string; [key: string]: string | number }");
    let ValidationShape::Object {
        undeclared,
        undeclared_value: Some(value),
        ..
    } = nodes[0].shape
    else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(undeclared, UndeclaredMembers::Validated);
    assert!(matches!(
        shape_of(&nodes, value),
        ValidationShape::Union { .. }
    ));
    let a = find_member(&fragment, &nodes, ROOT, "a");
    assert_eq!(
        *shape_of(&nodes, a.node),
        primitive(ValidatedPrimitive::String)
    );
}

#[test]
fn other_index_signatures_are_unsupported() {
    assert_eq!(
        unsupported_part("", "{ rows: { [index: number]: string } }"),
        "rows: { [index: number]: string; }"
    );
    let both = "{ both: { [key: string]: number; [index: number]: number } }";
    assert!(unsupported_part("", both).starts_with(b"both: "));
}

#[test]
fn tuple_names_each_element() {
    let (_, nodes) = nodes_of("", "[string, number]");
    let ValidationShape::Tuple { elements } = &nodes[0].shape else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(elements[..], [1, 2]);
    assert_eq!(nodes[1].shape, primitive(ValidatedPrimitive::String));
    assert_eq!(nodes[2].shape, primitive(ValidatedPrimitive::Number));
}

#[test]
fn template_literal_is_rule() {
    let (fragment, nodes) = nodes_of("", "`id-${number}`");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].shape, primitive(ValidatedPrimitive::String));
    let [ValidationRule::Template { head, parts }] = &nodes[0].rules[..] else {
        panic!("{:?}", nodes[0].rules);
    };
    assert_eq!(text_of(&fragment, *head), "id-");
    let [TemplatePart { placeholder, text }] = parts[..] else {
        panic!("{parts:?}");
    };
    assert_eq!(placeholder, TemplatePlaceholder::Number);
    assert_eq!(text_of(&fragment, text), "");
    let type_text = nodes[0].text.map(|text| text_of(&fragment, text));
    assert_eq!(type_text, Some(BStr::new("`id-${number}`")));
}

#[test]
fn template_parts_stay_in_order() {
    let (fragment, nodes) = nodes_of("", "`${string}:${bigint}px`");
    let [ValidationRule::Template { head, parts }] = &nodes[0].rules[..] else {
        panic!("{:?}", nodes[0].rules);
    };
    assert_eq!(text_of(&fragment, *head), "");
    let parts: Vec<(TemplatePlaceholder, &BStr)> = parts
        .iter()
        .map(|part| (part.placeholder, text_of(&fragment, part.text)))
        .collect();
    assert_eq!(
        parts,
        [
            (TemplatePlaceholder::String, BStr::new(":")),
            (TemplatePlaceholder::BigInt, BStr::new("px")),
        ]
    );
}

#[test]
fn text_and_numeric_placeholders_are_supported() {
    let placeholders = [
        (ShapeKind::String, TemplatePlaceholder::String),
        (ShapeKind::Number, TemplatePlaceholder::Number),
        (ShapeKind::BigInt, TemplatePlaceholder::BigInt),
    ];
    for (kind, placeholder) in placeholders {
        assert_eq!(placeholder_of(kind), Some(placeholder), "{kind:?}");
    }
}

#[test]
fn any_placeholder_validates_as_string() {
    let any = ShapeKind::Anything(AnythingReason::Any);
    assert_eq!(placeholder_of(any), Some(TemplatePlaceholder::String));

    let (_, nodes) = nodes_of("", "`id-${any}`");
    let [ValidationRule::Template { parts, .. }] = &nodes[0].rules[..] else {
        panic!("{:?}", nodes[0].rules);
    };
    let placeholders: Vec<TemplatePlaceholder> =
        parts.iter().map(|part| part.placeholder).collect();
    assert_eq!(placeholders, [TemplatePlaceholder::String]);
}

#[test]
fn unknown_placeholder_is_unsupported() {
    let reasons = [
        AnythingReason::Unknown,
        AnythingReason::EmptyObjectType,
        AnythingReason::Void,
    ];
    for reason in reasons {
        let kind = ShapeKind::Anything(reason);
        assert_eq!(placeholder_of(kind), None, "{kind:?}");
    }
    for kind in [ShapeKind::Boolean, ShapeKind::Null, ShapeKind::Object] {
        assert_eq!(placeholder_of(kind), None, "{kind:?}");
    }
}

#[test]
fn type_variables_below_root_are_unsupported() {
    let in_template = "function probe<T extends string>(text: string) {\n\
        return JSON.parse<`id-${T}`>(text);\n\
        }\n";
    assert_eq!(
        unsupported_arguments(in_template),
        ["JSON.parse", "`id-${T}`", "`id-${T}`"]
    );
    let in_member = "function probe<T>(text: string) {\n\
        return JSON.parse<{ a: T }>(text);\n\
        }\n";
    assert_eq!(unsupported_arguments(in_member)[2], "a: T");
}

#[test]
fn types_without_json_form_are_unsupported() {
    assert_eq!(unsupported_part("", "{ a: void }"), "a: void");
    assert_eq!(unsupported_part("", "{ a: 10n }"), "a: 10n");
    assert_eq!(unsupported_part("", "{ run(): void }"), "run: () => void");
    assert_eq!(
        unsupported_part("class Box { v = 1 }", "{ items: [Box] }"),
        "items[0]: Box"
    );
}

#[test]
fn primitive_arms_follow_checker_order() {
    let (fragment, nodes) = nodes_of("", r#""b" | null | "a""#);
    let ValidationShape::Union { arms } = &nodes[0].shape else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(arms[..], [1, 2, 3]);
    let literal = |text: &str| ValidationShape::StringLiteral {
        value: find_string(&fragment, text),
    };
    assert_eq!(nodes[1].shape, ValidationShape::Null);
    assert_eq!(nodes[2].shape, literal("a"));
    assert_eq!(nodes[3].shape, literal("b"));
}

fn arm_texts(fragment: &Fragment, nodes: &[ValidationNode], union: u32) -> Vec<String> {
    let ValidationShape::Union { arms } = shape_of(nodes, union) else {
        panic!("node {union} is {:?}", shape_of(nodes, union));
    };
    let describe = |&arm: &u32| match (shape_of(nodes, arm), nodes[arm as usize].text) {
        (ValidationShape::Object { .. }, Some(text)) => text_of(fragment, text).to_string(),
        (ValidationShape::Dictionary { .. }, _) => "dictionary".to_owned(),
        (ValidationShape::Array { .. }, _) => "array".to_owned(),
        (ValidationShape::Null, _) => "null".to_owned(),
        (ValidationShape::Undefined, _) => "undefined".to_owned(),
        (shape, _) => format!("{shape:?}"),
    };
    arms.iter().map(describe).collect()
}

const OVERLAPPING_TYPES: &str = "interface Zed { a: number }\n\
    interface Abe { a: unknown }\n\
    type ZedFirst = Zed | Abe;\n\
    type AbeFirst = Abe | ZedFirst;\n\
    type OrNull<T> = T | null;\n\
    type Either<A, B> = A | B;\n\
    interface Box<T> { value: T | Abe }\n";

#[test]
fn arms_that_build_values_follow_written_order() {
    for (ty, expected) in [
        ("Zed | Abe", ["Zed", "Abe"]),
        ("Abe | Zed", ["Abe", "Zed"]),
        ("Zed | Record<string, number>", ["Zed", "dictionary"]),
        ("Record<string, number> | Zed", ["dictionary", "Zed"]),
        ("Abe | Record<string, number>", ["Abe", "dictionary"]),
        ("Record<string, number> | Abe", ["dictionary", "Abe"]),
        ("Zed[] | Abe", ["array", "Abe"]),
        ("ZedFirst", ["Zed", "Abe"]),
        ("AbeFirst", ["Abe", "Zed"]),
        ("Either<Zed, Abe>", ["Zed", "Abe"]),
        ("Either<Abe, Zed>", ["Abe", "Zed"]),
        ("(Zed | Abe) & Schema.Strict", ["Zed", "Abe"]),
        ("(Abe | Zed) & Schema.Strict", ["Abe", "Zed"]),
    ] {
        let (fragment, nodes) = nodes_of(OVERLAPPING_TYPES, ty);
        assert_eq!(arm_texts(&fragment, &nodes, ROOT), expected, "{ty}");
    }
}

#[test]
fn written_order_is_found_below_the_root() {
    for (ty, member, expected) in [
        ("{ x: Zed | Abe }", "x", ["Zed", "Abe"]),
        ("{ x: Abe | Zed }", "x", ["Abe", "Zed"]),
        ("{ x?: Zed | Abe }", "x", ["Zed", "Abe"]),
        ("{ x: Zed | Abe | undefined }", "x", ["Zed", "Abe"]),
        ("{ x: OrNull<Zed | Abe> }", "x", ["Zed", "Abe"]),
        ("{ x: OrNull<ZedFirst> }", "x", ["Zed", "Abe"]),
        ("Box<Zed>", "value", ["Zed", "Abe"]),
        ("Partial<{ x: Zed | Abe }>", "x", ["Zed", "Abe"]),
    ] {
        let (fragment, nodes) = nodes_of(OVERLAPPING_TYPES, ty);
        let member = find_member(&fragment, &nodes, ROOT, member);
        let mut arms = arm_texts(&fragment, &nodes, member.node);
        arms.retain(|arm| arm != "null" && arm != "undefined");
        assert_eq!(arms, expected, "{ty}");
    }
    let (fragment, nodes) = nodes_of(OVERLAPPING_TYPES, "(Zed | Abe)[]");
    let ValidationShape::Array { element } = nodes[0].shape else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(arm_texts(&fragment, &nodes, element), ["Zed", "Abe"]);
}

fn arm_nodes(ty: &str) -> Vec<ValidationNode> {
    let (_, nodes) = nodes_of("", ty);
    let ValidationShape::Union { arms } = &nodes[0].shape else {
        panic!("{:?}", nodes[0].shape);
    };
    arms.iter()
        .map(|&arm| nodes[arm as usize].clone())
        .collect()
}

#[test]
fn constrained_primitive_is_ordered_as_written_only_with_default() {
    let tested = arm_nodes("(number & Schema.Max<1>) | (string & Schema.MaxLength<3>)");
    let turned = arm_nodes("(string & Schema.MaxLength<3>) | (number & Schema.Max<1>)");
    assert_eq!(tested, turned);

    let default_of = |ty: &str| arm_nodes(ty)[0].rules.clone();
    assert_eq!(
        default_of("(number & Schema.Default<2>) | (number & Schema.Default<1>)"),
        [ValidationRule::DefaultNumber { value: 2.0 }]
    );
    assert_eq!(
        default_of("(number & Schema.Default<1>) | (number & Schema.Default<2>)"),
        [ValidationRule::DefaultNumber { value: 1.0 }]
    );
}

#[test]
fn union_that_nobody_wrote_goes_by_first_mentions() {
    let declarations = format!("{OVERLAPPING_TYPES}interface Cid {{ a: boolean }}\n");
    let (fragment, nodes) = nodes_of(&declarations, "Exclude<ZedFirst | Cid | null, null>");
    assert_eq!(arm_texts(&fragment, &nodes, ROOT), ["Zed", "Abe", "Cid"]);
    let (fragment, nodes) = nodes_of(&declarations, "Exclude<Cid | ZedFirst | null, null>");
    assert_eq!(arm_texts(&fragment, &nodes, ROOT), ["Cid", "Zed", "Abe"]);
}

#[test]
fn one_union_type_written_in_two_orders_has_two_descriptions() {
    let body = "export const first = JSON.parse<Zed | Abe>(text);\n\
        export const second = JSON.parse<Abe | Zed>(text);\n\
        export const third = JSON.parse<Zed | Abe>(text);\n";
    let lowered = lower_main(&format!(
        "{HEADER}{TEXT_DECLARATION}{OVERLAPPING_TYPES}{body}"
    ));
    let fragment = &lowered.fragment;
    let [first, second, third] = &fragment.expected_results[..] else {
        panic!("{:?}", fragment.expected_results);
    };
    assert_eq!(arm_texts(fragment, &first.validation, ROOT), ["Zed", "Abe"]);
    assert_eq!(
        arm_texts(fragment, &second.validation, ROOT),
        ["Abe", "Zed"]
    );
    assert_eq!(first.validation, third.validation);
}

#[test]
fn branded_template_literal_has_text_of_template() {
    let declarations = "type Path = `/${string}` & { readonly __brand: \"Path\" };";
    let (fragment, nodes) = nodes_of(declarations, "Path");
    assert_eq!(nodes[0].shape, primitive(ValidatedPrimitive::String));
    let type_text = nodes[0].text.map(|text| text_of(&fragment, text));
    assert_eq!(type_text, Some(BStr::new("`/${string}`")));
}

#[test]
fn recursive_type_ends() {
    let (fragment, nodes) = nodes_of("interface Tree { children: Tree[] }", "Tree");
    assert_eq!(nodes.len(), 2);
    let children = find_member(&fragment, &nodes, ROOT, "children");
    assert_eq!(
        *shape_of(&nodes, children.node),
        ValidationShape::Array { element: ROOT }
    );
}

#[test]
fn shared_type_is_one_node() {
    let declarations = "interface Point { x: number }\ninterface Size { x: number }";
    let (fragment, nodes) = nodes_of(declarations, "{ a: Point; b: Point; c: Size }");
    let a = find_member(&fragment, &nodes, ROOT, "a");
    let b = find_member(&fragment, &nodes, ROOT, "b");
    let c = find_member(&fragment, &nodes, ROOT, "c");
    assert_eq!(a.node, b.node);
    assert_ne!(a.node, c.node);
}

#[test]
fn equal_type_is_described_once() {
    let body = "interface Point { x: number }\n\
        export const first = JSON.parse<Point>(text);\n\
        export const second = JSON.parse<Point>(text);\n\
        export const third = JSON.parse<{ y: string }>(text);\n";
    let lowered = lower_main(&format!("{HEADER}{TEXT_DECLARATION}{body}"));
    let [first, second, third] = &lowered.fragment.expected_results[..] else {
        panic!("{:?}", lowered.fragment.expected_results);
    };
    assert!(!first.validation.is_empty());
    assert_eq!(first.validation, second.validation);
    assert_ne!(first.validation, third.validation);
}

#[test]
fn type_over_node_limit_is_reported() {
    let limit = LimitValues::for_host().get(LimitId::MaxValidationNodes);
    let lower_union = |arm_count: u64| {
        let arms: Vec<String> = (0..arm_count).map(|arm| arm.to_string()).collect();
        lower_probe(&format!("type Wide = {};", arms.join(" | ")), "Wide")
    };

    let oversized = lower_union(limit);
    let arguments = ["JSON.parse", "Wide", "Wide"].map(BString::from);
    assert_eq!(
        collect_diagnostics(&oversized),
        [(Code::UnsupportedValidationType, arguments.to_vec())]
    );
    assert_eq!(count_node_limit_losses(&oversized), 1);
    assert!(oversized.fragment.expected_results.is_empty());

    let largest = lower_union(limit - 1);
    assert!(largest.diagnostics.is_empty());
    assert_eq!(count_node_limit_losses(&largest), 0);
    let [expected] = &largest.fragment.expected_results[..] else {
        panic!("the call has one expected result");
    };
    assert_eq!(expected.validation.len() as u64, limit);
}
