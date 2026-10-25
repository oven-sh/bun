use bstr::{BStr, BString};
use bun_sema::check::aot::{AnythingReason, ShapeKind};

use super::{ROOT, find_node_tested_against_itself, placeholder_of};
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

fn refused_rule(declarations: &str, ty: &str) -> BString {
    let lowered = lower_probe(declarations, ty);
    assert!(lowered.fragment.expected_results.is_empty(), "{ty}");
    let mut found = collect_diagnostics(&lowered);
    assert_eq!(found.len(), 1, "{ty}: {found:?}");
    let (code, mut arguments) = found.remove(0);
    assert_eq!(code, Code::RefusedValidationRule, "{ty}");
    assert_eq!(arguments.len(), 2, "{ty}");
    assert_eq!(arguments[0], "JSON.parse", "{ty}");
    arguments.remove(1)
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

fn rules_of_member<'n>(
    fragment: &Fragment,
    nodes: &'n [ValidationNode],
    name: &str,
) -> &'n [ValidationRule] {
    &nodes[find_member(fragment, nodes, ROOT, name).node as usize].rules
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
            single: string & Schema.Pattern<"^.$", "u">;
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
        is_unicode: false,
    };
    let unicode_pattern = ValidationRule::Pattern {
        source: string("^.$"),
        is_unicode: true,
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
        ("single", vec![unicode_pattern]),
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
    let refused = [
        (
            "{ unbounded: number & Schema.Min<number> }",
            "unbounded: Min",
        ),
        (
            "{ negative: string & Schema.MinLength<-1> }",
            "negative: MinLength",
        ),
        (
            r#"{ ambiguous: string & Schema.Format<"email" | "uuid"> }"#,
            "ambiguous: Format",
        ),
        (
            "{ whole: number & Schema.Int & Schema.Max<number> }",
            "whole: Max",
        ),
        (
            "{ held: unknown[] & Schema.Contains<string, -1> }",
            "held: Contains",
        ),
        (
            "{ held: unknown[] & Schema.Contains<string, 1, number> }",
            "held: Contains",
        ),
        (
            r#"{ matched: string & Schema.Pattern<"^a", "" | "u"> }"#,
            "matched: Pattern",
        ),
    ];
    for (ty, rule) in refused {
        assert_eq!(refused_rule("", ty), rule, "{ty}");
        let lowered = lower_probe("", ty);
        assert_eq!(lowered.queries.invalid_schema_arguments, 1, "{ty}");
    }
}

fn assert_is_refused(lowered: &LoweredFile, ty: &str) {
    let codes: Vec<Code> = collect_diagnostics(lowered)
        .into_iter()
        .map(|(code, _)| code)
        .collect();
    assert_eq!(codes, [Code::RefusedValidationRule], "{ty}");
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
fn strict_alone_is_closed_object_without_members() {
    for ty in [
        "Schema.Strict",
        "Schema.DeepStrict",
        "{} & Schema.Strict",
        "{} & Schema.DeepStrict",
    ] {
        let (_, nodes) = nodes_of("", ty);
        assert_eq!(
            nodes[0].shape,
            ValidationShape::Object {
                layout: None,
                members: Vec::new(),
                undeclared: UndeclaredMembers::Rejected,
                undeclared_value: None,
            },
            "{ty}"
        );
        assert!(nodes[0].rules.is_empty(), "{ty}");
    }
}

#[test]
fn strict_on_shape_without_members_is_refused() {
    let refused = [
        ("{ a: object & Schema.Strict }", "a: Strict"),
        ("{ a: unknown[] & Schema.Strict }", "a: Strict"),
        ("{ a: [number] & Schema.Strict }", "a: Strict"),
        ("{ a: string & Schema.Strict }", "a: Strict"),
        ("{ a: 1 & Schema.Strict }", "a: Strict"),
        ("{ a: object & Schema.DeepStrict }", "a: DeepStrict"),
        ("{ a: number & Schema.DeepStrict }", "a: DeepStrict"),
        (r#"{ a: "x" & Schema.DeepStrict }"#, "a: DeepStrict"),
        (
            "{ a: ({ b: number } | string) & Schema.DeepStrict }",
            "a: DeepStrict",
        ),
    ];
    for (ty, rule) in refused {
        assert_eq!(refused_rule("", ty), rule, "{ty}");
    }
}

#[test]
fn every_key_of_dictionary_is_declared() {
    for ty in [
        "Record<string, number> & Schema.Strict",
        "Record<string, number> & Schema.DeepStrict",
    ] {
        let (_, nodes) = nodes_of("", ty);
        assert!(
            matches!(nodes[0].shape, ValidationShape::Dictionary { .. }),
            "{ty}"
        );
        assert!(nodes[0].rules.is_empty(), "{ty}");
    }
}

#[test]
fn deep_strict_reaches_elements() {
    let (_, nodes) = nodes_of("", "{ a: number }[] & Schema.DeepStrict");
    let ValidationShape::Array { element } = nodes[0].shape else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(undeclared_of(&nodes, element), UndeclaredMembers::Rejected);

    let (_, nodes) = nodes_of("", "[{ a: 1 }, ...{ b: 2 }[]] & Schema.DeepStrict");
    let ValidationShape::Tuple {
        ref elements,
        required: 1,
        rest: Some(rest),
    } = nodes[0].shape
    else {
        panic!("{:?}", nodes[0].shape);
    };
    assert_eq!(
        undeclared_of(&nodes, elements[0]),
        UndeclaredMembers::Rejected
    );
    assert_eq!(undeclared_of(&nodes, rest), UndeclaredMembers::Rejected);
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
    assert_eq!(
        nodes[0].shape,
        ValidationShape::Tuple {
            elements: vec![1, 2],
            required: 2,
            rest: None,
        }
    );
    assert_eq!(nodes[1].shape, primitive(ValidatedPrimitive::String));
    assert_eq!(nodes[2].shape, primitive(ValidatedPrimitive::Number));
}

#[test]
fn tuple_counts_required_elements_and_names_rest() {
    let (_, nodes) = nodes_of("", "[string, number?, ...boolean[]]");
    assert_eq!(
        nodes[0].shape,
        ValidationShape::Tuple {
            elements: vec![1, 2],
            required: 1,
            rest: Some(3),
        }
    );
    assert_eq!(nodes[1].shape, primitive(ValidatedPrimitive::String));
    assert_eq!(nodes[2].shape, primitive(ValidatedPrimitive::Number));
    assert_eq!(nodes[3].shape, primitive(ValidatedPrimitive::Boolean));

    let (_, nodes) = nodes_of("", "[...string[]]");
    assert_eq!(nodes[0].shape, ValidationShape::Array { element: 1 });
}

#[test]
fn optional_element_has_node_of_its_written_type() {
    for ty in [
        "[number, string?]",
        "[number, (string | undefined)?]",
        "string & Schema.Not<[number, string?]>",
    ] {
        let (_, nodes) = nodes_of("", ty);
        let tuple = nodes.iter().find_map(|node| {
            if let ValidationShape::Tuple {
                elements,
                required: 1,
                rest: None,
            } = &node.shape
            {
                Some(elements)
            } else {
                None
            }
        });
        let [_, optional] = tuple.expect("the type holds a tuple")[..] else {
            panic!("{ty}: {tuple:?}");
        };
        let string = primitive(ValidatedPrimitive::String);
        assert_eq!(*shape_of(&nodes, optional), string, "{ty}");
        let has_undefined = nodes
            .iter()
            .any(|node| node.shape == ValidationShape::Undefined);
        assert!(!has_undefined, "{ty}");
    }
}

#[test]
fn optional_element_that_is_there_is_not_undefined() {
    for ty in ["[(string | null)?]", "[(string | number)?]"] {
        let (_, nodes) = nodes_of("", ty);
        let ValidationShape::Tuple {
            elements,
            required: 0,
            rest: None,
        } = &nodes[0].shape
        else {
            panic!("{ty}: {:?}", nodes[0].shape);
        };
        let ValidationShape::Union { arms } = shape_of(&nodes, elements[0]) else {
            panic!("{ty}: {:?}", shape_of(&nodes, elements[0]));
        };
        assert_eq!(arms.len(), 2, "{ty}");
        let has_undefined = nodes
            .iter()
            .any(|node| node.shape == ValidationShape::Undefined);
        assert!(!has_undefined, "{ty}");
    }
}

#[test]
fn elements_after_rest_are_unsupported() {
    let after_rest = unsupported_part("", "{ a: [string, ...number[], boolean] }");
    assert!(after_rest.starts_with(b"a: ["), "{after_rest}");
    let variadic = "function probe<T extends unknown[]>(text: string) {\n\
        return JSON.parse<{ a: [string, ...T] }>(text);\n\
        }\n";
    assert!(unsupported_arguments(variadic)[2].starts_with(b"a: ["));
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

#[test]
fn type_cut_short_by_limit_of_checker_has_no_nodes_of_another_type() {
    let declarations = r#"type Wrap<N extends unknown[]> = N["length"] extends 150 ? string : [Wrap<[...N, 0]>][0];
        type Table = { [K in "a"]: Wrap<[]> extends string ? 1 : 2 };"#;
    let lowered = lower_probe(declarations, "Table");
    let Some(expected) = lowered.fragment.expected_results.first() else {
        let found = collect_diagnostics(&lowered);
        let codes: Vec<Code> = found.into_iter().map(|(code, _)| code).collect();
        assert_eq!(codes, [Code::UnsupportedValidationType]);
        return;
    };
    let a = find_member(&lowered.fragment, &expected.validation, ROOT, "a");
    assert_eq!(
        *shape_of(&expected.validation, a.node),
        ValidationShape::NumberLiteral { value: 1.0 }
    );
}

#[test]
fn rules_without_type_arguments() {
    let declarations = r#"interface Rules {
            distinct: number[] & Schema.UniqueItems;
            sized: Record<string, number> & Schema.MinProperties<1> & Schema.MaxProperties<3>;
            paid: { card?: string; street?: string; city?: string; name?: string } & Schema.DependentRequired<{
                card: ["street", "city"];
                street: ["city"];
            }>;
        }"#;
    let (fragment, nodes) = nodes_of(declarations, "Rules");
    let string = |text: &str| find_string(&fragment, text);
    assert_eq!(
        rules_of_member(&fragment, &nodes, "distinct"),
        [ValidationRule::UniqueItems]
    );
    assert_eq!(
        rules_of_member(&fragment, &nodes, "sized"),
        [
            ValidationRule::MinimumMembers { count: 1 },
            ValidationRule::MaximumMembers { count: 3 },
        ]
    );
    assert_eq!(
        rules_of_member(&fragment, &nodes, "paid"),
        [
            ValidationRule::DependentMembers {
                key: string("card"),
                names: vec![string("street"), string("city")],
            },
            ValidationRule::DependentMembers {
                key: string("street"),
                names: vec![string("city")],
            },
        ]
    );
}

#[test]
fn rules_name_nodes_of_type_arguments() {
    let declarations = r#"interface Rules {
            holds: unknown[] & Schema.Contains<string>;
            bounded: unknown[] & Schema.Contains<string, 2, 4>;
            other: string & Schema.Not<"x">;
            chosen: unknown[] & Schema.If<string[], unknown[] & Schema.MinItems<1>, number[]>;
            half: unknown[] & Schema.If<string[], unknown[] & Schema.MinItems<1>>;
            single: number & Schema.OneOf<[number & Schema.Min<1>, number & Schema.Max<9>]>;
            both: number & Schema.AllOf<[number & Schema.Min<1>, number & Schema.Max<9>]>;
            keyed: Record<string, unknown> & Schema.PropertyNames<string & Schema.MaxLength<3>>;
            billed: { card?: string } & Schema.DependentSchemas<{ card: { street: string } }>;
        }"#;
    let (fragment, nodes) = nodes_of(declarations, "Rules");
    let rules = |name: &str| rules_of_member(&fragment, &nodes, name);
    let string = primitive(ValidatedPrimitive::String);
    let minimum = [ValidationRule::Minimum { bound: 1.0 }];
    let maximum = [ValidationRule::Maximum { bound: 9.0 }];
    let element_of = |node: u32| match *shape_of(&nodes, node) {
        ValidationShape::Array { element } => shape_of(&nodes, element).clone(),
        ref shape => panic!("node {node} is {shape:?}"),
    };

    let [
        ValidationRule::Contains {
            node,
            minimum: 1,
            maximum: None,
        },
    ] = *rules("holds")
    else {
        panic!("{:?}", rules("holds"));
    };
    assert_eq!(*shape_of(&nodes, node), string);
    assert_eq!(
        rules("bounded"),
        [ValidationRule::Contains {
            node,
            minimum: 2,
            maximum: Some(4),
        }]
    );

    let [ValidationRule::Not { node }] = *rules("other") else {
        panic!("{:?}", rules("other"));
    };
    let literal = ValidationShape::StringLiteral {
        value: find_string(&fragment, "x"),
    };
    assert_eq!(*shape_of(&nodes, node), literal);

    let [
        ValidationRule::If {
            condition,
            then,
            otherwise,
        },
    ] = *rules("chosen")
    else {
        panic!("{:?}", rules("chosen"));
    };
    assert_eq!(element_of(condition), string);
    assert_eq!(element_of(then), ValidationShape::Unknown);
    assert_eq!(
        nodes[then as usize].rules,
        [ValidationRule::MinimumLength { length: 1 }]
    );
    assert_eq!(element_of(otherwise), primitive(ValidatedPrimitive::Number));

    let [ValidationRule::If { otherwise, .. }] = *rules("half") else {
        panic!("{:?}", rules("half"));
    };
    assert_eq!(*shape_of(&nodes, otherwise), ValidationShape::Unknown);
    assert!(nodes[otherwise as usize].rules.is_empty());

    let [ValidationRule::ExactlyOne { nodes: arms }] = rules("single") else {
        panic!("{:?}", rules("single"));
    };
    let [ValidationRule::Every { nodes: parts }] = rules("both") else {
        panic!("{:?}", rules("both"));
    };
    assert_eq!(arms, parts);
    let [first, second] = arms[..] else {
        panic!("{arms:?}");
    };
    assert_eq!(nodes[first as usize].rules, minimum);
    assert_eq!(nodes[second as usize].rules, maximum);

    let [ValidationRule::MemberNames { node }] = *rules("keyed") else {
        panic!("{:?}", rules("keyed"));
    };
    assert_eq!(*shape_of(&nodes, node), string);
    assert_eq!(
        nodes[node as usize].rules,
        [ValidationRule::MaximumLength { length: 3 }]
    );

    let [ValidationRule::DependentNode { key, node }] = *rules("billed") else {
        panic!("{:?}", rules("billed"));
    };
    assert_eq!(text_of(&fragment, key), "card");
    let street = find_member(&fragment, &nodes, node, "street");
    assert_eq!(*shape_of(&nodes, street.node), string);
}

#[test]
fn rule_with_nothing_beside_it_is_refused() {
    let refused = [
        ("Schema.Not<string>", "Not"),
        ("unknown & Schema.Not<string>", "Not"),
        ("{} & Schema.Not<string>", "Not"),
        ("{ a: {} & Schema.MinProperties<1> }", "a: MinProperties"),
        (r#"{ a: unknown & Schema.Format<"ipv4"> }"#, "a: Format"),
        (
            r#"{ a: {} & Schema.PatternProperties<{ "^x-": string }> }"#,
            "a: PatternProperties",
        ),
        (r#"{ a: Schema.Message<"no"> }"#, "a: Message"),
        ("{ a?: Schema.Default<1> }", "a: Default"),
        ("{ a: Schema.UniqueItems[] }", "a[number]: UniqueItems"),
        (
            "{ a: string & Schema.Not<Schema.Not<string>> }",
            "a<Schema.Not>: Not",
        ),
    ];
    for (ty, rule) in refused {
        assert_eq!(refused_rule("", ty), rule, "{ty}");
    }
}

#[test]
fn rule_that_reads_one_kind_of_value_needs_shape_of_that_kind() {
    let refused = [
        ("Schema.MinItems<1>", "MinItems"),
        ("{ a: unknown & Schema.Min<1> }", "a: Min"),
        ("{ a: string & Schema.Min<1> }", "a: Min"),
        ("{ a: string & Schema.MaxItems<1> }", "a: MaxItems"),
        ("{ a: number[] & Schema.MinLength<1> }", "a: MinLength"),
        ("{ a: number & Schema.Pattern<\"x\"> }", "a: Pattern"),
        ("{ a: boolean & Schema.Int }", "a: Int"),
        (
            "{ a: string & Schema.Not<Schema.MaxLength<1>> }",
            "a<Schema.Not>: MaxLength",
        ),
    ];
    for (ty, rule) in refused {
        assert_eq!(refused_rule("", ty), rule, "{ty}");
    }
}

#[test]
fn patterns_stand_beside_their_nodes() {
    let ty = r#"{ a: boolean } & Schema.Strict & Schema.PatternProperties<{ "^x-": string; "\\d$": number }>"#;
    let (fragment, nodes) = nodes_of("", ty);
    assert_eq!(undeclared_of(&nodes, ROOT), UndeclaredMembers::Rejected);
    let [
        ValidationRule::PatternMembers {
            sources,
            nodes: tested,
        },
    ] = &nodes[0].rules[..]
    else {
        panic!("{:?}", nodes[0].rules);
    };
    let mut pairs: Vec<(&BStr, &ValidationShape)> = sources
        .iter()
        .zip(tested)
        .map(|(&source, &node)| (text_of(&fragment, source), shape_of(&nodes, node)))
        .collect();
    pairs.sort_by_key(|&(source, _)| source);
    assert_eq!(sources.len(), tested.len());
    assert_eq!(
        pairs,
        [
            (BStr::new("\\d$"), &primitive(ValidatedPrimitive::Number)),
            (BStr::new("^x-"), &primitive(ValidatedPrimitive::String)),
        ]
    );
}

fn undeclared_members_of(ty: &str) -> (UndeclaredMembers, Option<ValidationShape>) {
    let (_, nodes) = nodes_of("", ty);
    let ValidationShape::Object {
        undeclared,
        undeclared_value,
        ..
    } = nodes[0].shape
    else {
        panic!("{ty}: {:?}", nodes[0].shape);
    };
    let value = undeclared_value.map(|value| shape_of(&nodes, value).clone());
    (undeclared, value)
}

#[test]
fn second_argument_of_patterns_says_what_other_keys_hold() {
    let number = primitive(ValidatedPrimitive::Number);
    let expected = [
        (
            r#"{ a: boolean } & Schema.PatternProperties<{ "^x-": string }>"#,
            (UndeclaredMembers::Allowed, None),
        ),
        (
            r#"{ a: boolean } & Schema.PatternProperties<{ "^x-": string }, unknown>"#,
            (UndeclaredMembers::Allowed, None),
        ),
        (
            r#"{ a: boolean } & Schema.PatternProperties<{ "^x-": string }, never>"#,
            (UndeclaredMembers::Rejected, None),
        ),
        (
            r#"{ a: boolean } & Schema.PatternProperties<{ "^x-": string }, number>"#,
            (UndeclaredMembers::Validated, Some(number.clone())),
        ),
        (
            r#"{ a: boolean } & Schema.PatternProperties<{ "^x-": string }, number> & Schema.Strict"#,
            (UndeclaredMembers::Rejected, None),
        ),
        (
            r#"{ a: boolean } & Schema.Strict & Schema.PatternProperties<{ "^x-": string }, number>"#,
            (UndeclaredMembers::Rejected, None),
        ),
        (
            r#"{ a: boolean } & Schema.DeepStrict & Schema.PatternProperties<{ "^x-": string }, number>"#,
            (UndeclaredMembers::Rejected, None),
        ),
        (
            "{ a: boolean } & Schema.PatternProperties<{}, number>",
            (UndeclaredMembers::Validated, Some(number)),
        ),
    ];
    for (ty, undeclared) in expected {
        assert_eq!(undeclared_members_of(ty), undeclared, "{ty}");
    }
    let (_, nodes) = nodes_of("", "{ a: boolean } & Schema.PatternProperties<{}, number>");
    assert!(nodes[0].rules.is_empty());
}

#[test]
fn patterns_beside_anything_but_listed_members_are_refused() {
    let refused = [
        r#"Record<string, number> & Schema.PatternProperties<{ "^x-": string }>"#,
        r#"Record<string, string> & Schema.PatternProperties<{ "^x-": string }>"#,
        r#"{ a: string; [key: string]: string } & Schema.PatternProperties<{ "^x-": string }>"#,
        "Record<string, number> & Schema.PatternProperties<{}>",
        r#"object & Schema.PatternProperties<{ "^x-": string }>"#,
        r#"string[] & Schema.PatternProperties<{ "^x-": string }>"#,
        r#"string & Schema.PatternProperties<{ "^x-": string }>"#,
        "{ a: 1 } & Schema.PatternProperties<{ x: 1 }> & Schema.PatternProperties<{ y: 2 }>",
        "{ a: 1 } & Schema.PatternProperties<{}, never> & Schema.PatternProperties<{ y: 2 }>",
    ];
    for ty in refused {
        assert_eq!(refused_rule("", ty), "PatternProperties", "{ty}");
    }
}

#[test]
fn deep_strict_reaches_what_patterns_name() {
    let tested_by = |ty: &str| {
        let (_, nodes) = nodes_of("", ty);
        let [ValidationRule::PatternMembers { nodes: tested, .. }] = &nodes[0].rules[..] else {
            panic!("{ty}: {:?}", nodes[0].rules);
        };
        undeclared_of(&nodes, tested[0])
    };
    assert_eq!(
        tested_by(
            r#"{ id: number } & Schema.DeepStrict & Schema.PatternProperties<{ "^x-": { a: number } }>"#
        ),
        UndeclaredMembers::Rejected
    );
    assert_eq!(
        tested_by(
            r#"{ id: number } & Schema.PatternProperties<{ "^x-": { a: number } }> & Schema.DeepStrict"#
        ),
        UndeclaredMembers::Rejected
    );
    assert_eq!(
        tested_by(
            r#"{ id: number } & Schema.Strict & Schema.PatternProperties<{ "^x-": { a: number } }>"#
        ),
        UndeclaredMembers::Allowed
    );

    let ty = r#"{ outer: { id: number } & Schema.PatternProperties<{ "^x-": string }, { a: number }> } & Schema.DeepStrict"#;
    let (fragment, nodes) = nodes_of("", ty);
    let outer = find_member(&fragment, &nodes, ROOT, "outer");
    assert_eq!(
        undeclared_of(&nodes, outer.node),
        UndeclaredMembers::Rejected
    );
}

#[test]
fn type_arguments_of_rules_are_as_strict_as_written() {
    let ty = "{ a: number } & Schema.DeepStrict & Schema.Not<{ b: number }> \
        & Schema.AllOf<[{ c: number } & Schema.Strict]>";
    let (_, nodes) = nodes_of("", ty);
    assert_eq!(undeclared_of(&nodes, ROOT), UndeclaredMembers::Rejected);
    let [
        ValidationRule::Not { node: loose },
        ValidationRule::Every { nodes: parts },
    ] = &nodes[0].rules[..]
    else {
        panic!("{:?}", nodes[0].rules);
    };
    assert_eq!(undeclared_of(&nodes, *loose), UndeclaredMembers::Allowed);
    assert_eq!(undeclared_of(&nodes, parts[0]), UndeclaredMembers::Rejected);

    let ty = "{ a?: number } & Schema.DeepStrict & Schema.If<{ b: number }, { c: number }, { d: number }> \
        & Schema.OneOf<[{ e: number }]> & Schema.DependentSchemas<{ a: { f: number } }>";
    let (_, nodes) = nodes_of("", ty);
    let [
        ValidationRule::If {
            condition,
            then,
            otherwise,
        },
        ValidationRule::ExactlyOne { nodes: arms },
        ValidationRule::DependentNode { node, .. },
    ] = &nodes[0].rules[..]
    else {
        panic!("{:?}", nodes[0].rules);
    };
    for operand in [*condition, *then, *otherwise, arms[0], *node] {
        assert_eq!(undeclared_of(&nodes, operand), UndeclaredMembers::Allowed);
    }

    let ty = "{ a: number }[] & Schema.DeepStrict & Schema.Contains<{ a: 1 }>";
    let (_, nodes) = nodes_of("", ty);
    let [ValidationRule::Contains { node, .. }] = nodes[0].rules[..] else {
        panic!("{:?}", nodes[0].rules);
    };
    assert_eq!(undeclared_of(&nodes, node), UndeclaredMembers::Allowed);
}

#[test]
fn every_format_has_rule() {
    let formats = [
        ("email", TextFormat::Email),
        ("uuid", TextFormat::Uuid),
        ("ipv4", TextFormat::Ipv4),
        ("ipv6", TextFormat::Ipv6),
        ("date", TextFormat::Date),
        ("date-time", TextFormat::DateTime),
        ("url", TextFormat::Url),
        ("time", TextFormat::Time),
        ("duration", TextFormat::Duration),
        ("hostname", TextFormat::Hostname),
        ("uri", TextFormat::Uri),
        ("uri-reference", TextFormat::UriReference),
        ("regex", TextFormat::Regex),
        ("json-pointer", TextFormat::JsonPointer),
        ("relative-json-pointer", TextFormat::RelativeJsonPointer),
    ];
    for (name, format) in formats {
        let (_, nodes) = nodes_of("", &format!("string & Schema.Format<\"{name}\">"));
        assert_eq!(
            nodes[0].rules,
            [ValidationRule::Format { format }],
            "{name}"
        );
    }
}

#[test]
fn refused_keyword_is_reported_with_its_place() {
    let refused = [
        (
            r#"Schema.Refused<"unevaluatedProperties">"#,
            "unevaluatedProperties",
        ),
        (
            r#"{ a: string & Schema.Refused<"$dynamicRef"> }"#,
            "a: $dynamicRef",
        ),
        (
            r#"{ a: (string | number) & Schema.Refused<"$id"> }"#,
            "a: $id",
        ),
        (
            r#"{ a: unknown[] & Schema.Contains<Schema.Refused<"$anchor">> }"#,
            "a<Schema.Contains>: $anchor",
        ),
        (
            r#"{ a: [string, (string & Schema.Not<Schema.Refused<"$anchor">>)?] }"#,
            "a[1]<Schema.Not>: $anchor",
        ),
        (
            r#"{ a: { b: 1 } & Schema.PatternProperties<{ x: Schema.Refused<"$id"> }> }"#,
            "a<Schema.PatternProperties>: $id",
        ),
        (
            r#"{ a: { b: 1 } & Schema.PatternProperties<{ x: 1 }, Schema.Refused<"$id">> }"#,
            "a<Schema.PatternProperties>: $id",
        ),
        (r#"{ a: symbol & Schema.Refused<"$id"> }"#, "a: $id"),
        (
            r#"{ a: string & Schema.Min<1> & Schema.Refused<"$id"> }"#,
            "a: $id",
        ),
        ("{ a: number & Schema.OneOf<[]> }", "a: OneOf"),
        ("{ a: number & Schema.AllOf<[]> }", "a: AllOf"),
    ];
    for (ty, rule) in refused {
        assert_eq!(refused_rule("", ty), rule, "{ty}");
    }
}

#[test]
fn unsupported_type_argument_is_reported_with_its_place() {
    assert_eq!(
        unsupported_part("", "{ a: string & Schema.Not<void> }"),
        "a<Schema.Not>: void"
    );
}

#[test]
fn key_of_rule_as_member_is_refused_whatever_its_modifiers() {
    let declarations = "type Writable<T> = { -readonly [K in keyof T]: T[K] };\n\
        interface Closed extends Schema.Strict { id: number }";
    let refused = [
        (
            "Writable<{ readonly id: number } & Schema.Strict>",
            "bun.strict",
        ),
        (
            r#"Writable<{ readonly name: string } & Schema.Not<{ name: "root" }>>"#,
            "bun.not",
        ),
        (
            "Required<{ a?: string } & Schema.MaxProperties<1>>",
            "bun.maxProperties",
        ),
        ("Partial<{ a: string } & Schema.Strict>", "bun.strict"),
        ("Readonly<{ a: string } & Schema.Strict>", "bun.strict"),
        ("Closed", "bun.strict"),
        (r#"{ a: { "bun.minLength": 8 } }"#, "a: bun.minLength"),
        (
            r#"{ a: { readonly "bun.minLength"?: 8; b: 1 } }"#,
            "a: bun.minLength",
        ),
        (r#"{ a: { "bun.int32"?: true; b: 1 } }"#, "a: bun.int32"),
    ];
    for (ty, key) in refused {
        assert_eq!(refused_rule(declarations, ty), key, "{ty}");
    }
}

#[test]
fn other_keys_that_begin_alike_are_members() {
    let ty = r#"{ "bun.lock": string; readonly "bun.future"?: true; "bun.Strict": 1; bun: 2 }"#;
    let (fragment, nodes) = nodes_of("", ty);
    let shape = |name: &str| shape_of(&nodes, find_member(&fragment, &nodes, ROOT, name).node);
    assert_eq!(*shape("bun.lock"), primitive(ValidatedPrimitive::String));
    assert_eq!(
        *shape("bun.future"),
        ValidationShape::BooleanLiteral { value: true }
    );
    assert_eq!(
        *shape("bun.Strict"),
        ValidationShape::NumberLiteral { value: 1.0 }
    );
    assert_eq!(*shape("bun"), ValidationShape::NumberLiteral { value: 2.0 });
}

#[test]
fn types_that_say_more_than_their_shape_are_unsupported() {
    let declarations = "enum Color { Red, Blue }\nnamespace Units { export const meter = 1; }";
    let unsupported = [
        ("{ a: Uppercase<string> }", "a: Uppercase<string>"),
        (
            "{ a: `id-${Lowercase<string>}` }",
            "a: `id-${Lowercase<string>}`",
        ),
        (
            "Record<string, number> & Schema.PropertyNames<Uppercase<string>>",
            "<Schema.PropertyNames>: Uppercase<string>",
        ),
        (
            "{ a: 1 } & Schema.PatternProperties<{ x: Capitalize<string> }>",
            "<Schema.PatternProperties>: Capitalize<string>",
        ),
        (
            "unknown[] & Schema.Contains<Uncapitalize<string>>",
            "<Schema.Contains>: Uncapitalize<string>",
        ),
        ("{ a: typeof Color }", "a: typeof Color"),
        ("{ a: typeof Units }", "a: typeof Units"),
        ("{ a: typeof globalThis }", "a: typeof globalThis"),
    ];
    for (ty, part) in unsupported {
        assert_eq!(unsupported_part(declarations, ty), part, "{ty}");
    }
}

fn unknown_with(rules: Vec<ValidationRule>) -> ValidationNode {
    ValidationNode {
        shape: ValidationShape::Unknown,
        rules,
        ..ValidationNode::default()
    }
}

#[test]
fn test_of_same_value_that_returns_to_its_node_is_found() {
    let plain = || unknown_with(Vec::new());
    let returning = [
        vec![unknown_with(vec![ValidationRule::Not { node: 0 }])],
        vec![unknown_with(vec![ValidationRule::Every { nodes: vec![0] }])],
        vec![
            plain(),
            unknown_with(vec![ValidationRule::ExactlyOne { nodes: vec![0, 2] }]),
            unknown_with(vec![ValidationRule::If {
                condition: 0,
                then: 0,
                otherwise: 3,
            }]),
            ValidationNode {
                shape: ValidationShape::Union { arms: vec![0, 1] },
                ..ValidationNode::default()
            },
        ],
    ];
    for nodes in returning {
        assert!(
            find_node_tested_against_itself(&nodes).is_some(),
            "{nodes:?}"
        );
    }

    let ending = [
        vec![
            unknown_with(vec![
                ValidationRule::Not { node: 1 },
                ValidationRule::Every { nodes: vec![1, 1] },
            ]),
            plain(),
        ],
        vec![unknown_with(vec![
            ValidationRule::Contains {
                node: 0,
                minimum: 1,
                maximum: None,
            },
            ValidationRule::MemberNames { node: 0 },
            ValidationRule::PatternMembers {
                sources: Vec::new(),
                nodes: vec![0],
            },
        ])],
        vec![ValidationNode {
            shape: ValidationShape::Array { element: 0 },
            ..ValidationNode::default()
        }],
    ];
    for nodes in ending {
        assert_eq!(find_node_tested_against_itself(&nodes), None, "{nodes:?}");
    }
}

#[test]
fn type_tested_against_itself_is_refused() {
    assert_eq!(
        refused_rule("type Loop = string & Schema.AllOf<[Loop]>;", "Loop"),
        "a type that is tested against itself"
    );
    let declarations = "interface Tree { children: Tree[] & Schema.Contains<Tree> }";
    let (fragment, nodes) = nodes_of(declarations, "Tree");
    assert_eq!(
        rules_of_member(&fragment, &nodes, "children"),
        [ValidationRule::Contains {
            node: ROOT,
            minimum: 1,
            maximum: None,
        }]
    );
}
