use super::{MAX_NESTED_NODES, write_json_schema};
use crate::ir::generated::{
    TemplatePart, TemplatePlaceholder, TextFormat, UndeclaredMembers, ValidatedPrimitive,
    ValidationMember, ValidationNode, ValidationRule, ValidationShape,
};
use crate::ir::{Program, PropertyKey, StringId, TypeTable};
use crate::lower::validate::misuse::tests::{HEADER, collect_diagnostics, lower_main};

const STRING: ValidationShape = ValidationShape::Primitive {
    primitive: ValidatedPrimitive::String,
};
const NUMBER: ValidationShape = ValidationShape::Primitive {
    primitive: ValidatedPrimitive::Number,
};

/// The schema of the TypeScript type `ty`, as JSON text.
fn schema_of(declarations: &str, ty: &str) -> String {
    let lowered = lower_main(&format!(
        "{HEADER}declare const text: string;\n{declarations}\nexport const probe = JSON.parse<{ty}>(text);\n"
    ));
    let diagnostics = collect_diagnostics(&lowered);
    assert!(diagnostics.is_empty(), "{ty}: {diagnostics:?}");
    let fragment = lowered.fragment;
    let [expected] = &fragment.expected_results[..] else {
        panic!("{ty}: expected one validated call");
    };
    let schema = write_json_schema(
        &fragment.strings,
        &fragment.property_keys,
        &expected.validation,
    );
    String::from_utf8(schema.to_text()).expect("the text of a schema is UTF-8")
}

/// The text of a root schema that has `keywords` and no `x-bun` member of its own.
fn root(keywords: &str) -> String {
    format!(r#"{{{keywords},"x-bun":{{"source":"typescript"}}}}"#)
}

fn node(shape: ValidationShape) -> ValidationNode {
    node_with_rules(shape, Vec::new())
}

fn node_with_rules(shape: ValidationShape, rules: Vec<ValidationRule>) -> ValidationNode {
    ValidationNode {
        shape,
        ty: TypeTable::ANYTHING,
        rules,
        text: None,
    }
}

fn intern(program: &mut Program, text: &str) -> StringId {
    program.strings.intern(text.as_bytes())
}

fn member(program: &mut Program, name: &str, node: u32, is_optional: bool) -> ValidationMember {
    let name = intern(program, name);
    ValidationMember {
        key: program.property_keys.intern(PropertyKey::from_text(name)),
        node,
        field: None,
        is_optional,
    }
}

fn object(members: Vec<ValidationMember>) -> ValidationShape {
    ValidationShape::Object {
        layout: None,
        members,
        undeclared: UndeclaredMembers::Allowed,
        undeclared_value: None,
    }
}

fn schema_of_nodes(program: &Program, nodes: &[ValidationNode]) -> String {
    let schema = write_json_schema(&program.strings, &program.property_keys, nodes);
    String::from_utf8(schema.to_text()).expect("the text of a schema is UTF-8")
}

fn schema_of_rules(shape: ValidationShape, rules: Vec<ValidationRule>) -> String {
    schema_of_nodes(&Program::new(), &[node_with_rules(shape, rules)])
}

#[test]
fn writes_primitives() {
    assert_eq!(schema_of("", "string"), root(r#""type":"string""#));
    assert_eq!(schema_of("", "number"), root(r#""type":"number""#));
    assert_eq!(schema_of("", "boolean"), root(r#""type":"boolean""#));
    assert_eq!(schema_of("", "null"), root(r#""type":"null""#));
}

#[test]
fn writes_types_that_json_schema_lacks_under_x_bun() {
    assert_eq!(
        schema_of("", "bigint"),
        r#"{"x-bun":{"type":"bigint","source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", "undefined"),
        r#"{"x-bun":{"type":"undefined","source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", "object"),
        r#"{"x-bun":{"type":"object","source":"typescript"}}"#
    );
}

#[test]
fn writes_never_as_false() {
    assert_eq!(schema_of("", "never"), "false");
    assert_eq!(
        schema_of("", "{ a: never }"),
        root(r#""type":"object","properties":{"a":false},"required":["a"]"#)
    );
}

#[test]
fn writes_unknown_as_an_empty_schema() {
    assert_eq!(
        schema_of("", "{ a: unknown; b: any }"),
        root(r#""type":"object","properties":{"a":{},"b":{}},"required":["a","b"]"#)
    );
}

#[test]
fn writes_literals_as_const() {
    assert_eq!(schema_of("", r#""a""#), root(r#""const":"a""#));
    assert_eq!(schema_of("", "5"), root(r#""const":5"#));
    assert_eq!(schema_of("", "-1.5"), root(r#""const":-1.5"#));
    assert_eq!(schema_of("", "true"), root(r#""const":true"#));
    assert_eq!(schema_of("", "false"), root(r#""const":false"#));
}

#[test]
fn writes_negative_zero() {
    let zero = ValidationShape::NumberLiteral { value: -0.0 };
    assert_eq!(schema_of_rules(zero, Vec::new()), root(r#""const":-0"#));
}

#[test]
fn writes_no_number_that_is_not_finite() {
    for value in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
        let literal = || node(ValidationShape::NumberLiteral { value });
        let program = Program::new();
        assert_eq!(schema_of_nodes(&program, &[literal()]), "false");
        let union = |arms: Vec<u32>| node(ValidationShape::Union { arms });
        let one = node(ValidationShape::NumberLiteral { value: 1.0 });
        assert_eq!(
            schema_of_nodes(&program, &[union(vec![1, 2]), literal(), one]),
            root(r#""enum":[1]"#)
        );
        assert_eq!(
            schema_of_nodes(&program, &[union(vec![1]), literal()]),
            "false"
        );
        assert_eq!(
            schema_of_nodes(&program, &[union(vec![1, 2]), literal(), node(STRING)]),
            root(r#""anyOf":[false,{"type":"string"}]"#)
        );
        assert_eq!(
            schema_of_rules(NUMBER, vec![ValidationRule::DefaultNumber { value }]),
            root(r#""type":"number""#)
        );
    }
}

#[test]
fn escapes_strings() {
    assert_eq!(
        schema_of("", r#""a\"b\\c\n\uD800é""#),
        root(r#""const":"a\"b\\c\n\uD800é""#)
    );
    assert_eq!(
        schema_of("", r#"{ "a\"\uDC00": 1 }"#),
        root(r#""type":"object","properties":{"a\"\uDC00":{"const":1}},"required":["a\"\uDC00"]"#)
    );
}

#[test]
fn writes_arrays() {
    assert_eq!(
        schema_of("", "string[]"),
        root(r#""type":"array","items":{"type":"string"}"#)
    );
    assert_eq!(
        schema_of("", "number[][]"),
        root(r#""type":"array","items":{"type":"array","items":{"type":"number"}}"#)
    );
}

#[test]
fn writes_tuples() {
    assert_eq!(
        schema_of("", "[string, number]"),
        root(
            r#""type":"array","prefixItems":[{"type":"string"},{"type":"number"}],"minItems":2,"items":false"#
        )
    );
    assert_eq!(
        schema_of("", "[string, number?]"),
        root(
            r#""type":"array","prefixItems":[{"type":"string"},{"type":"number"}],"minItems":1,"items":false"#
        )
    );
    assert_eq!(
        schema_of("", "[number?]"),
        root(r#""type":"array","prefixItems":[{"type":"number"}],"items":false"#)
    );
    assert_eq!(
        schema_of("", "[string, ...number[]]"),
        root(
            r#""type":"array","prefixItems":[{"type":"string"}],"minItems":1,"items":{"type":"number"}"#
        )
    );
    assert_eq!(schema_of("", "[]"), root(r#""type":"array","items":false"#));
}

#[test]
fn writes_dictionaries() {
    assert_eq!(
        schema_of("", "Record<string, number>"),
        root(r#""type":"object","additionalProperties":{"type":"number"}"#)
    );
}

#[test]
fn writes_objects_with_members_in_their_order() {
    assert_eq!(
        schema_of("", "{ z: string; a?: number; m: boolean }"),
        root(
            r#""type":"object","properties":{"z":{"type":"string"},"a":{"type":"number"},"m":{"type":"boolean"}},"required":["z","m"]"#
        )
    );
}

#[test]
fn leaves_out_empty_properties_and_required() {
    assert_eq!(schema_of("", "{}"), root(r#""type":"object""#));
    assert_eq!(
        schema_of("", "{ a?: string }"),
        root(r#""type":"object","properties":{"a":{"type":"string"}}"#)
    );
}

#[test]
fn writes_what_an_object_says_about_undeclared_members() {
    assert_eq!(
        schema_of("", "{ a: string } & Schema.Strict"),
        root(
            r#""type":"object","properties":{"a":{"type":"string"}},"required":["a"],"additionalProperties":false"#
        )
    );
    assert_eq!(
        schema_of("", "{ a: 1; [key: string]: number }"),
        root(
            r#""type":"object","properties":{"a":{"const":1}},"required":["a"],"additionalProperties":{"type":"number"}"#
        )
    );
}

#[test]
fn names_a_declared_type_in_title() {
    assert_eq!(
        schema_of("interface User { name: string }", "User"),
        root(
            r#""type":"object","properties":{"name":{"type":"string"}},"required":["name"],"title":"User""#
        )
    );
}

#[test]
fn writes_a_typical_object_type() {
    assert_eq!(
        schema_of(
            r#"type User = { id: number & Schema.Int; name: string; role: "admin" | "guest"; tags?: string[] };"#,
            "User"
        ),
        root(
            r#""type":"object","properties":{"id":{"type":"integer"},"name":{"type":"string"},"role":{"enum":["admin","guest"]},"tags":{"type":"array","items":{"type":"string"}}},"required":["id","name","role"],"title":"User""#
        )
    );
}

#[test]
fn keeps_undefined_apart_from_a_missing_member() {
    assert_eq!(
        schema_of("", "{ a: string | undefined }"),
        root(
            r#""type":"object","properties":{"a":{"anyOf":[{"x-bun":{"type":"undefined"}},{"type":"string"}]}},"required":["a"]"#
        )
    );
    assert_eq!(
        schema_of("", "(number | undefined)[]"),
        root(
            r#""type":"array","items":{"anyOf":[{"x-bun":{"type":"undefined"}},{"type":"number"}]}"#
        )
    );
}

#[test]
fn writes_unions_as_any_of() {
    assert_eq!(
        schema_of("", "string | number"),
        root(r#""anyOf":[{"type":"string"},{"type":"number"}]"#)
    );
    assert_eq!(
        schema_of("", r#"{ kind: "a"; a: string } | { kind: "b"; b: number }"#),
        root(
            r#""anyOf":[{"type":"object","properties":{"kind":{"const":"a"},"a":{"type":"string"}},"required":["kind","a"]},{"type":"object","properties":{"kind":{"const":"b"},"b":{"type":"number"}},"required":["kind","b"]}]"#
        )
    );
}

#[test]
fn writes_unions_of_literals_as_enum() {
    assert_eq!(schema_of("", r#""a" | "b""#), root(r#""enum":["a","b"]"#));
    assert_eq!(
        schema_of("", r#""a" | 1 | true | null"#),
        root(r#""enum":[null,"a",1,true]"#)
    );
}

#[test]
fn writes_any_of_when_an_arm_says_more_than_its_value() {
    assert_eq!(
        schema_of("", r#""a" | ("b" & Schema.Message<"no">)"#),
        root(r#""anyOf":[{"const":"a"},{"const":"b","x-bun":{"message":"no"}}]"#)
    );
    assert_eq!(
        schema_of("", r#""a" | number"#),
        root(r#""anyOf":[{"type":"number"},{"const":"a"}]"#)
    );
}

#[test]
fn writes_an_empty_union_as_false() {
    let union = ValidationShape::Union { arms: Vec::new() };
    assert_eq!(schema_of_rules(union, Vec::new()), "false");
}

#[test]
fn writes_template_literal_types() {
    assert_eq!(
        schema_of("", "`id-${number}`"),
        r#"{"type":"string","title":"`id-${number}`","x-bun":{"template":{"texts":["id-",""],"placeholders":["number"]},"source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", "`${string}/${bigint}.${number}px`"),
        r#"{"type":"string","title":"`${string}/${bigint}.${number}px`","x-bun":{"template":{"texts":["","/",".","px"],"placeholders":["string","bigint","number"]},"source":"typescript"}}"#
    );
}

#[test]
fn writes_every_placeholder() {
    let mut program = Program::new();
    let empty = intern(&mut program, "");
    let part = |placeholder| TemplatePart {
        placeholder,
        text: empty,
    };
    let template = ValidationRule::Template {
        head: empty,
        parts: vec![
            part(TemplatePlaceholder::String),
            part(TemplatePlaceholder::Number),
            part(TemplatePlaceholder::BigInt),
        ],
    };
    assert_eq!(
        schema_of_nodes(&program, &[node_with_rules(STRING, vec![template])]),
        r#"{"type":"string","x-bun":{"template":{"texts":["","","",""],"placeholders":["string","number","bigint"]},"source":"typescript"}}"#
    );
}

#[test]
fn writes_defaults() {
    assert_eq!(
        schema_of("", r#"string & Schema.Default<"x">"#),
        r#"{"type":"string","x-bun":{"default":"x","source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", "number & Schema.Default<1.5>"),
        r#"{"type":"number","x-bun":{"default":1.5,"source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", "true & Schema.Default<true>"),
        r#"{"const":true,"x-bun":{"default":true,"source":"typescript"}}"#
    );
    assert_eq!(
        schema_of_rules(STRING, vec![ValidationRule::DefaultNull]),
        r#"{"type":"string","x-bun":{"default":null,"source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", "{ port: number & Schema.Default<80> }"),
        root(
            r#""type":"object","properties":{"port":{"type":"number","x-bun":{"default":80}}},"required":["port"]"#
        )
    );
}

#[test]
fn writes_messages() {
    assert_eq!(
        schema_of("", r#"string & Schema.Message<"Enter a name">"#),
        r#"{"type":"string","x-bun":{"message":"Enter a name","source":"typescript"}}"#
    );
}

#[test]
fn puts_all_x_bun_members_of_a_node_in_one_object() {
    assert_eq!(
        schema_of(
            "",
            r#"string & Schema.Pattern<"^a"> & Schema.Message<"no"> & Schema.Default<"a">"#
        ),
        r#"{"type":"string","x-bun":{"pattern":"^a","message":"no","default":"a","source":"typescript"}}"#
    );
}

#[test]
fn keeps_what_stands_beside_never() {
    let mut program = Program::new();
    let message = ValidationRule::Message {
        text: intern(&mut program, "no"),
    };
    let never = node_with_rules(ValidationShape::Never, vec![message]);
    assert_eq!(
        schema_of_nodes(&program, &[never]),
        r#"{"not":{},"x-bun":{"message":"no","source":"typescript"}}"#
    );
}

#[test]
fn writes_rules_of_numbers() {
    assert_eq!(
        schema_of("", "number & Schema.Int"),
        root(r#""type":"integer""#)
    );
    assert_eq!(
        schema_of("", "int32"),
        root(r#""type":"integer","minimum":-2147483648,"maximum":2147483647"#)
    );
    assert_eq!(
        schema_of("", "number & Schema.Min<1> & Schema.Max<2.5>"),
        root(r#""type":"number","minimum":1,"maximum":2.5"#)
    );
    assert_eq!(
        schema_of("", "number & Schema.Above<0> & Schema.Below<10>"),
        root(r#""type":"number","exclusiveMinimum":0,"exclusiveMaximum":10"#)
    );
    assert_eq!(
        schema_of("", "number & Schema.MultipleOf<0.01>"),
        root(r#""type":"number","multipleOf":0.01"#)
    );
}

#[test]
fn writes_rules_beside_a_literal() {
    let rules = vec![
        ValidationRule::Integer,
        ValidationRule::Minimum { bound: 3.0 },
    ];
    assert_eq!(
        schema_of_rules(ValidationShape::NumberLiteral { value: 5.0 }, rules),
        root(r#""const":5,"type":"integer","minimum":3"#)
    );
}

#[test]
fn writes_a_negative_divisor_without_its_sign() {
    let rules = vec![ValidationRule::MultipleOf { divisor: -3.0 }];
    assert_eq!(
        schema_of_rules(NUMBER, rules),
        root(r#""type":"number","multipleOf":3"#)
    );
}

#[test]
fn leaves_out_infinite_bounds_that_every_number_meets() {
    let rules = vec![
        ValidationRule::Minimum {
            bound: f64::NEG_INFINITY,
        },
        ValidationRule::ExclusiveMinimum {
            bound: f64::NEG_INFINITY,
        },
        ValidationRule::Maximum {
            bound: f64::INFINITY,
        },
        ValidationRule::ExclusiveMaximum {
            bound: f64::INFINITY,
        },
    ];
    assert_eq!(schema_of_rules(NUMBER, rules), root(r#""type":"number""#));
}

#[test]
fn refuses_numbers_at_infinite_bounds_that_no_number_meets() {
    let refused = root(r#""type":"number","not":{"type":"number"}"#);
    for rule in [
        ValidationRule::Minimum {
            bound: f64::INFINITY,
        },
        ValidationRule::ExclusiveMinimum {
            bound: f64::INFINITY,
        },
        ValidationRule::Maximum {
            bound: f64::NEG_INFINITY,
        },
        ValidationRule::ExclusiveMaximum {
            bound: f64::NEG_INFINITY,
        },
    ] {
        assert_eq!(schema_of_rules(NUMBER, vec![rule]), refused);
    }
}

#[test]
fn writes_rules_of_strings() {
    assert_eq!(
        schema_of("", "string & Schema.MinLength<1> & Schema.MaxLength<8>"),
        root(r#""type":"string","minLength":1,"maxLength":8"#)
    );
    assert_eq!(
        schema_of("", r#"string & Schema.Pattern<"^\\p{L}+$", "u">"#),
        root(r#""type":"string","pattern":"^\\p{L}+$""#)
    );
    assert_eq!(
        schema_of("", r#"string & Schema.Pattern<"^[a-z]+$">"#),
        r#"{"type":"string","x-bun":{"pattern":"^[a-z]+$","source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", r#"string & Schema.Format<"date-time">"#),
        root(r#""type":"string","format":"date-time""#)
    );
}

#[test]
fn writes_every_format() {
    let formats = [
        (TextFormat::Email, "email"),
        (TextFormat::Uuid, "uuid"),
        (TextFormat::Ipv4, "ipv4"),
        (TextFormat::Ipv6, "ipv6"),
        (TextFormat::Date, "date"),
        (TextFormat::DateTime, "date-time"),
        (TextFormat::Url, "url"),
        (TextFormat::Time, "time"),
        (TextFormat::Duration, "duration"),
        (TextFormat::Hostname, "hostname"),
        (TextFormat::Uri, "uri"),
        (TextFormat::UriReference, "uri-reference"),
        (TextFormat::Regex, "regex"),
        (TextFormat::JsonPointer, "json-pointer"),
        (TextFormat::RelativeJsonPointer, "relative-json-pointer"),
    ];
    for (format, name) in formats {
        assert_eq!(
            schema_of_rules(STRING, vec![ValidationRule::Format { format }]),
            root(&format!(r#""type":"string","format":"{name}""#))
        );
    }
}

#[test]
fn writes_rules_of_arrays() {
    assert_eq!(
        schema_of(
            "",
            "string[] & Schema.MinItems<1> & Schema.MaxItems<3> & Schema.UniqueItems"
        ),
        root(
            r#""type":"array","items":{"type":"string"},"minItems":1,"maxItems":3,"uniqueItems":true"#
        )
    );
    assert_eq!(
        schema_of("", "unknown[] & Schema.Contains<string>"),
        root(r#""type":"array","items":{},"contains":{"type":"string"},"minContains":1"#)
    );
    assert_eq!(
        schema_of("", "unknown[] & Schema.Contains<string, 0, 2>"),
        root(
            r#""type":"array","items":{},"contains":{"type":"string"},"minContains":0,"maxContains":2"#
        )
    );
}

#[test]
fn writes_the_larger_minimum_of_a_tuple() {
    let tuple = |required: u32, length: u32| {
        let shape = ValidationShape::Tuple {
            elements: vec![1, 1, 1],
            required,
            rest: Some(1),
        };
        let rules = vec![
            ValidationRule::MinimumLength { length },
            ValidationRule::MaximumLength { length: 9 },
        ];
        schema_of_nodes(
            &Program::new(),
            &[node_with_rules(shape, rules), node(NUMBER)],
        )
    };
    let expected = |min_items: u32| {
        root(&format!(
            r#""type":"array","prefixItems":[{{"type":"number"}},{{"type":"number"}},{{"type":"number"}}],"minItems":{min_items},"items":{{"type":"number"}},"maxItems":9"#
        ))
    };
    assert_eq!(tuple(2, 5), expected(5));
    assert_eq!(tuple(3, 1), expected(3));
    assert_eq!(tuple(0, 4), expected(4));
}

#[test]
fn writes_rules_that_hold_schemas() {
    assert_eq!(
        schema_of("", r#"string & Schema.Not<"a">"#),
        root(r#""type":"string","not":{"const":"a"}"#)
    );
    assert_eq!(
        schema_of("", r#"string & Schema.If<"a", "a" | "b", string>"#),
        root(
            r#""type":"string","if":{"const":"a"},"then":{"enum":["a","b"]},"else":{"type":"string"}"#
        )
    );
    assert_eq!(
        schema_of("", r#"string & Schema.If<"a">"#),
        root(r#""type":"string","if":{"const":"a"},"then":{},"else":{}"#)
    );
    assert_eq!(
        schema_of(
            "",
            r#"string & Schema.OneOf<["a", string & Schema.MinLength<2>]>"#
        ),
        root(r#""type":"string","oneOf":[{"const":"a"},{"type":"string","minLength":2}]"#)
    );
    assert_eq!(
        schema_of(
            "",
            "string & Schema.AllOf<[string & Schema.MinLength<2>, string & Schema.MaxLength<4>]>"
        ),
        root(
            r#""type":"string","allOf":[{"type":"string","minLength":2},{"type":"string","maxLength":4}]"#
        )
    );
}

#[test]
fn writes_rules_of_objects() {
    assert_eq!(
        schema_of(
            "",
            r#"{ a?: 1 } & Schema.PatternProperties<{ "^x-": string; "^n-": number }, never>"#
        ),
        root(
            r#""type":"object","properties":{"a":{"const":1}},"additionalProperties":false,"patternProperties":{"^x-":{"type":"string"},"^n-":{"type":"number"}}"#
        )
    );
    assert_eq!(
        schema_of(
            "",
            "Record<string, number> & Schema.PropertyNames<string & Schema.MaxLength<3>>"
        ),
        root(
            r#""type":"object","additionalProperties":{"type":"number"},"propertyNames":{"type":"string","maxLength":3}"#
        )
    );
    assert_eq!(
        schema_of(
            "",
            "Record<string, number> & Schema.MinProperties<1> & Schema.MaxProperties<4>"
        ),
        root(
            r#""type":"object","additionalProperties":{"type":"number"},"minProperties":1,"maxProperties":4"#
        )
    );
}

#[test]
fn collects_dependent_rules_under_one_keyword() {
    assert_eq!(
        schema_of(
            "",
            r#"{ a?: 1; b?: 1; c?: 1 } & Schema.DependentRequired<{ a: ["b", "c"]; b: ["c"] }>"#
        ),
        root(
            r#""type":"object","properties":{"a":{"const":1},"b":{"const":1},"c":{"const":1}},"dependentRequired":{"a":["b","c"],"b":["c"]}"#
        )
    );
    assert_eq!(
        schema_of(
            "",
            r#"{ a?: 1; b?: 1 } & Schema.DependentSchemas<{ a: { b: 1 }; b: { a: 1 } }>"#
        ),
        root(
            r#""type":"object","properties":{"a":{"const":1},"b":{"const":1}},"dependentSchemas":{"a":{"type":"object","properties":{"b":{"const":1}},"required":["b"]},"b":{"type":"object","properties":{"a":{"const":1}},"required":["a"]}}"#
        )
    );
}

#[test]
fn wraps_a_second_rule_of_the_same_kind_in_all_of() {
    assert_eq!(
        schema_of("", "int32 & Schema.Min<0>"),
        root(
            r#""type":"integer","minimum":-2147483648,"maximum":2147483647,"allOf":[{"minimum":0}]"#
        )
    );
    assert_eq!(
        schema_of(
            "",
            r#"string & Schema.Pattern<"^a", "u"> & Schema.Pattern<"z$", "u">"#
        ),
        root(r#""type":"string","pattern":"^a","allOf":[{"pattern":"z$"}]"#)
    );
    assert_eq!(
        schema_of(
            "",
            r#"string & Schema.Pattern<"^a"> & Schema.Pattern<"z$">"#
        ),
        r#"{"type":"string","allOf":[{"x-bun":{"pattern":"z$"}}],"x-bun":{"pattern":"^a","source":"typescript"}}"#
    );
    assert_eq!(
        schema_of("", r#"string & Schema.Not<"a"> & Schema.Not<"b">"#),
        root(r#""type":"string","not":{"const":"a"},"allOf":[{"not":{"const":"b"}}]"#)
    );
}

#[test]
fn wraps_keywords_that_belong_together_as_one() {
    let choose = |condition: u32| ValidationRule::If {
        condition,
        then: 1,
        otherwise: 2,
    };
    let contain = |node: u32| ValidationRule::Contains {
        node,
        minimum: 1,
        maximum: Some(2),
    };
    let nodes = [
        node_with_rules(
            ValidationShape::Unknown,
            vec![choose(1), choose(2), contain(1), contain(2)],
        ),
        node(STRING),
        node(NUMBER),
    ];
    assert_eq!(
        schema_of_nodes(&Program::new(), &nodes),
        root(
            r#""if":{"type":"string"},"then":{"type":"string"},"else":{"type":"number"},"contains":{"type":"string"},"minContains":1,"maxContains":2,"allOf":[{"if":{"type":"number"},"then":{"type":"string"},"else":{"type":"number"}},{"contains":{"type":"number"},"minContains":1,"maxContains":2}]"#
        )
    );
}

#[test]
fn adds_wrapped_rules_to_the_all_of_that_is_written() {
    let nodes = [
        node_with_rules(
            NUMBER,
            vec![
                ValidationRule::Minimum { bound: 1.0 },
                ValidationRule::Every { nodes: vec![1] },
                ValidationRule::Minimum { bound: 2.0 },
                ValidationRule::Every { nodes: vec![1] },
            ],
        ),
        node(NUMBER),
    ];
    assert_eq!(
        schema_of_nodes(&Program::new(), &nodes),
        root(
            r#""type":"number","minimum":1,"allOf":[{"type":"number"},{"minimum":2},{"type":"number"}]"#
        )
    );
}

#[test]
fn wraps_a_second_entry_for_the_same_key() {
    let mut program = Program::new();
    let (a, b, c) = (
        intern(&mut program, "a"),
        intern(&mut program, "b"),
        intern(&mut program, "c"),
    );
    let nodes = [
        node_with_rules(
            object(Vec::new()),
            vec![
                ValidationRule::DependentMembers {
                    key: a,
                    names: vec![b],
                },
                ValidationRule::DependentMembers {
                    key: a,
                    names: vec![c],
                },
                ValidationRule::DependentNode { key: a, node: 1 },
                ValidationRule::DependentNode { key: a, node: 2 },
            ],
        ),
        node(STRING),
        node(NUMBER),
    ];
    assert_eq!(
        schema_of_nodes(&program, &nodes),
        root(
            r#""type":"object","dependentRequired":{"a":["b"]},"dependentSchemas":{"a":{"type":"string"}},"allOf":[{"dependentRequired":{"a":["c"]}},{"dependentSchemas":{"a":{"type":"number"}}}]"#
        )
    );
}

#[test]
fn writes_rules_that_repeat_without_a_difference_once() {
    let rules = vec![ValidationRule::Integer, ValidationRule::Integer];
    assert_eq!(schema_of_rules(NUMBER, rules), root(r#""type":"integer""#));
    let nodes = [
        node_with_rules(
            ValidationShape::Array { element: 1 },
            vec![ValidationRule::UniqueItems, ValidationRule::UniqueItems],
        ),
        node(NUMBER),
    ];
    assert_eq!(
        schema_of_nodes(&Program::new(), &nodes),
        root(r#""type":"array","items":{"type":"number"},"uniqueItems":true"#)
    );
}

#[test]
fn refers_to_a_recursive_root_as_the_document() {
    assert_eq!(
        schema_of("interface Tree { value: number; children: Tree[] }", "Tree"),
        root(
            r##""type":"object","properties":{"value":{"type":"number"},"children":{"type":"array","items":{"$ref":"#"}}},"required":["value","children"],"title":"Tree""##
        )
    );
}

#[test]
fn moves_a_recursive_type_below_the_root_to_defs() {
    assert_eq!(
        schema_of("interface List { next: List | null }", "{ list: List }"),
        r##"{"type":"object","properties":{"list":{"$ref":"#/$defs/1"}},"required":["list"],"x-bun":{"source":"typescript"},"$defs":{"1":{"type":"object","properties":{"next":{"anyOf":[{"type":"null"},{"$ref":"#/$defs/1"}]}},"required":["next"],"title":"List"}}}"##
    );
}

#[test]
fn writes_types_that_refer_to_each_other() {
    assert_eq!(
        schema_of(
            "interface A { b: B | null }\ninterface B { a: A | null; b: B | null }",
            "A"
        ),
        r##"{"type":"object","properties":{"b":{"$ref":"#/$defs/1"}},"required":["b"],"title":"A","x-bun":{"source":"typescript"},"$defs":{"1":{"anyOf":[{"type":"null"},{"type":"object","properties":{"a":{"anyOf":[{"type":"null"},{"$ref":"#"}]},"b":{"$ref":"#/$defs/1"}},"required":["a","b"],"title":"B"}]}}}"##
    );
}

#[test]
fn moves_a_type_that_is_used_twice_to_defs() {
    assert_eq!(
        schema_of(
            "interface Point { x: number }",
            "{ from: Point; to: Point }"
        ),
        r##"{"type":"object","properties":{"from":{"$ref":"#/$defs/1"},"to":{"$ref":"#/$defs/1"}},"required":["from","to"],"x-bun":{"source":"typescript"},"$defs":{"1":{"type":"object","properties":{"x":{"type":"number"}},"required":["x"],"title":"Point"}}}"##
    );
}

#[test]
fn copies_a_schema_that_mentions_no_other() {
    assert_eq!(
        schema_of("", "{ a: string; b: string; c: string[] }"),
        root(
            r#""type":"object","properties":{"a":{"type":"string"},"b":{"type":"string"},"c":{"type":"array","items":{"type":"string"}}},"required":["a","b","c"]"#
        )
    );
}

#[test]
fn sorts_defs_by_index() {
    let mut program = Program::new();
    let members = vec![
        member(&mut program, "a", 3, false),
        member(&mut program, "b", 2, false),
        member(&mut program, "c", 3, false),
        member(&mut program, "d", 2, false),
        member(&mut program, "e", 10, false),
        member(&mut program, "f", 10, false),
    ];
    let mut nodes = vec![node(object(members)), node(NUMBER)];
    nodes.resize_with(11, || node(ValidationShape::Array { element: 1 }));
    let array = r#"{"type":"array","items":{"type":"number"}}"#;
    assert_eq!(
        schema_of_nodes(&program, &nodes),
        format!(
            r##"{{"type":"object","properties":{{"a":{{"$ref":"#/$defs/3"}},"b":{{"$ref":"#/$defs/2"}},"c":{{"$ref":"#/$defs/3"}},"d":{{"$ref":"#/$defs/2"}},"e":{{"$ref":"#/$defs/10"}},"f":{{"$ref":"#/$defs/10"}}}},"required":["a","b","c","d","e","f"],"x-bun":{{"source":"typescript"}},"$defs":{{"2":{array},"3":{array},"10":{array}}}}}"##
        )
    );
}

#[test]
fn counts_only_uses_that_the_root_reaches() {
    let nodes = [
        node(ValidationShape::Array { element: 1 }),
        node(ValidationShape::Array { element: 2 }),
        node(NUMBER),
        node(ValidationShape::Array { element: 1 }),
    ];
    assert_eq!(
        schema_of_nodes(&Program::new(), &nodes),
        root(r#""type":"array","items":{"type":"array","items":{"type":"number"}}"#)
    );
}

#[test]
fn counts_uses_in_every_place_that_holds_a_node() {
    let mut program = Program::new();
    let key = intern(&mut program, "k");
    let shared = 1;
    let rule_holder = |rule: ValidationRule| (ValidationShape::Unknown, vec![rule]);
    let holders: Vec<(ValidationShape, Vec<ValidationRule>)> = vec![
        (ValidationShape::Array { element: shared }, Vec::new()),
        (
            ValidationShape::Tuple {
                elements: vec![shared],
                required: 0,
                rest: None,
            },
            Vec::new(),
        ),
        (
            ValidationShape::Tuple {
                elements: Vec::new(),
                required: 0,
                rest: Some(shared),
            },
            Vec::new(),
        ),
        (ValidationShape::Dictionary { value: shared }, Vec::new()),
        (
            object(vec![member(&mut program, "m", shared, false)]),
            Vec::new(),
        ),
        (
            ValidationShape::Object {
                layout: None,
                members: Vec::new(),
                undeclared: UndeclaredMembers::Validated,
                undeclared_value: Some(shared),
            },
            Vec::new(),
        ),
        (ValidationShape::Union { arms: vec![shared] }, Vec::new()),
        rule_holder(ValidationRule::Contains {
            node: shared,
            minimum: 1,
            maximum: None,
        }),
        rule_holder(ValidationRule::Not { node: shared }),
        rule_holder(ValidationRule::If {
            condition: shared,
            then: 2,
            otherwise: 2,
        }),
        rule_holder(ValidationRule::If {
            condition: 2,
            then: shared,
            otherwise: 2,
        }),
        rule_holder(ValidationRule::If {
            condition: 2,
            then: 2,
            otherwise: shared,
        }),
        rule_holder(ValidationRule::ExactlyOne {
            nodes: vec![shared],
        }),
        rule_holder(ValidationRule::Every {
            nodes: vec![shared],
        }),
        rule_holder(ValidationRule::PatternMembers {
            sources: vec![key],
            nodes: vec![shared],
        }),
        rule_holder(ValidationRule::MemberNames { node: shared }),
        rule_holder(ValidationRule::DependentNode { key, node: shared }),
    ];
    for (shape, rules) in holders {
        // The root uses node 1 once, and so does the holder.
        let nodes = [
            node(ValidationShape::Tuple {
                elements: vec![shared, 3],
                required: 0,
                rest: None,
            }),
            node(ValidationShape::Array { element: 2 }),
            node(NUMBER),
            node_with_rules(shape, rules),
        ];
        let schema = schema_of_nodes(&program, &nodes);
        let uses = schema.matches(r##"{"$ref":"#/$defs/1"}"##).count();
        assert_eq!(uses, 2, "{schema}");
        assert!(
            schema.ends_with(r#""$defs":{"1":{"type":"array","items":{"type":"number"}}}}"#),
            "{schema}"
        );
    }
}

#[test]
fn moves_deeply_nested_schemas_to_defs() {
    let depth = 3 * MAX_NESTED_NODES + 5;
    let mut nodes: Vec<ValidationNode> = (1..=depth)
        .map(|element| node(ValidationShape::Array { element }))
        .collect();
    nodes.push(node(NUMBER));
    let text = schema_of_nodes(&Program::new(), &nodes);
    for step in 1..=3 {
        let index = step * (MAX_NESTED_NODES + 1);
        let reference = format!(r##"{{"$ref":"#/$defs/{index}"}}"##);
        assert!(text.contains(&reference), "{text}");
        let definition = format!(r#""{index}":{{"type":"array""#);
        assert!(text.contains(&definition), "{text}");
    }
    assert_eq!(text.matches("$ref").count(), 3, "{text}");
    let arrays = text.matches(r#""type":"array""#).count();
    assert_eq!(arrays, depth as usize, "{text}");
    let nesting = text.bytes().scan(0u32, |open, byte| {
        *open = *open + u32::from(byte == b'{') - u32::from(byte == b'}');
        Some(*open)
    });
    assert!(nesting.max() <= Some(MAX_NESTED_NODES + 4), "{text}");
}

#[test]
fn writes_a_key_named_proto_like_any_other() {
    assert_eq!(
        schema_of("", r#"{ "__proto__": string }"#),
        root(
            r#""type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]"#
        )
    );
}
