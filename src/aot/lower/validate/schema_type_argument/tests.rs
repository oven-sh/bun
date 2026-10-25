use bstr::BString;

use super::IS_INTERSECTED;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{ValidationNode, ValidationRule, ValidationShape};
use crate::lower::LoweredFile;
use crate::lower::validate::json_schema::{NoProof, Reason};
use crate::lower::validate::misuse::tests::{HEADER, collect_diagnostics, lower_main};

const VALUES: &str = "declare const value: unknown;\ndeclare const text: string;\n";
const SCHEMA_TYPE: &str = "Schema.FromJSONSchema<typeof schema>";

fn lower(body: &str) -> LoweredFile {
    lower_main(&format!("{HEADER}{VALUES}{body}\n"))
}

fn validate_as(ty: &str) -> String {
    format!("validate<{ty}>(value)")
}

fn parse_as(ty: &str) -> String {
    format!("JSON.parse<{ty}>(text)")
}

fn declare_schema(schema: &str) -> String {
    format!("const schema = {schema} as const;")
}

// The cast gives the written schema the type of another schema, so the validated type is not the one that the written schema describes.
fn declare_schema_typed_as(schema: &str, other: &str) -> String {
    format!(
        "const other = {other} as const;\n\
         const schema = {schema} as unknown as typeof other;"
    )
}

fn declare_schema_cast_to(schema: &str, ty: &str) -> String {
    format!("const schema = {schema} as unknown as {ty};")
}

fn probe(declarations: &str, call: &str) -> String {
    format!("{declarations}\nexport const probe = {call};")
}

fn validated(schema: &str) -> String {
    probe(&declare_schema(schema), &validate_as(SCHEMA_TYPE))
}

fn parsed(schema: &str) -> String {
    probe(&declare_schema(schema), &parse_as(SCHEMA_TYPE))
}

fn validated_with_type_of(schema: &str, other: &str) -> String {
    probe(
        &declare_schema_typed_as(schema, other),
        &validate_as(SCHEMA_TYPE),
    )
}

fn parsed_with_type_of(schema: &str, other: &str) -> String {
    probe(
        &declare_schema_typed_as(schema, other),
        &parse_as(SCHEMA_TYPE),
    )
}

// What a validator checks, without the layouts that compiled code builds and the names that errors print.
fn list_checks(nodes: &[ValidationNode]) -> Vec<(ValidationShape, Vec<ValidationRule>)> {
    let checks = nodes.iter().map(|node| {
        let mut shape = node.shape.clone();
        if let ValidationShape::Object {
            layout, members, ..
        } = &mut shape
        {
            *layout = None;
            for member in members {
                member.field = None;
            }
        }
        (shape, node.rules.clone())
    });
    checks.collect()
}

/// `declarations` declare `schema`. The validator of its type checks what the validator of `ty` checks.
fn assert_compiles_like(declarations: &str, call_as: fn(&str) -> String, ty: &str) {
    let body = format!(
        "{declarations}\n\
         export const probe = {};\n\
         export const written = {};",
        call_as(SCHEMA_TYPE),
        call_as(ty)
    );
    let lowered = lower(&body);
    let diagnostics = collect_diagnostics(&lowered);
    assert!(diagnostics.is_empty(), "{body}: {diagnostics:?}");
    let [from_schema, written] = &lowered.fragment.expected_results[..] else {
        panic!("{body}: {:?}", lowered.fragment.expected_results);
    };
    assert!(!written.validation.is_empty(), "{body}");
    assert_eq!(
        list_checks(&from_schema.validation),
        list_checks(&written.validation),
        "{body}"
    );
}

fn assert_validates_like(schema: &str, ty: &str) {
    assert_compiles_like(&declare_schema(schema), validate_as, ty);
}

fn assert_parses_like(schema: &str, ty: &str) {
    assert_compiles_like(&declare_schema(schema), parse_as, ty);
}

fn only_error(body: &str) -> (Code, Vec<BString>) {
    let lowered = lower(body);
    assert!(lowered.fragment.expected_results.is_empty(), "{body}");
    let mut diagnostics = collect_diagnostics(&lowered);
    assert_eq!(diagnostics.len(), 1, "{body}: {diagnostics:?}");
    diagnostics.remove(0)
}

fn assert_not_read(body: &str) {
    let error = only_error(body);
    let arguments = ["Schema.FromJSONSchema", "the schema"].map(BString::from);
    assert_eq!(
        error,
        (Code::ValidatorSchemaIsNotRead, arguments.to_vec()),
        "{body}"
    );
}

fn assert_not_compiled(body: &str, reason: &[u8]) {
    let error = only_error(body);
    let arguments = [&b"Schema.FromJSONSchema"[..], reason].map(BString::from);
    assert_eq!(
        error,
        (Code::ValidatorSchemaIsNotCompiled, arguments.to_vec()),
        "{body}"
    );
}

fn assert_disagrees(body: &str, keyword: &str, place: &str, reason: Reason) {
    let no_proof = NoProof {
        keyword: keyword.as_bytes().to_vec(),
        place: place.as_bytes().to_vec(),
        reason,
    };
    assert_not_compiled(body, &no_proof.describe());
}

/// The type of the schema has no translation, so there is no type to hold against the schema.
fn assert_has_no_translation(body: &str, function: &str, keyword_and_place: &str) {
    let arguments = [function, keyword_and_place].map(BString::from);
    assert_eq!(
        only_error(body),
        (Code::RefusedValidationRule, arguments.to_vec()),
        "{body}"
    );
}

#[test]
fn compiles_schema_like_matching_type() {
    let point = r#"{ type: "object", properties: { x: { type: "number" } }, required: ["x"], additionalProperties: false }"#;
    assert_validates_like(point, "{ x: number } & Schema.Strict");
    assert_parses_like(point, "{ x: number } & Schema.Strict");
    assert_validates_like(r#"{ type: "string" }"#, "string");
    assert_validates_like(r#"{ type: ["string", "null"] }"#, "string | null");
    assert_validates_like(
        r#"{ enum: ["a", "b", 1, null] }"#,
        r#""a" | "b" | 1 | null"#,
    );
}

#[test]
fn closed_object_needs_closed_type() {
    let closed = r#"{ type: "object", additionalProperties: false }"#;
    let open = r#"{ type: "object" }"#;
    let (keyword, place) = ("additionalProperties", "#/additionalProperties");
    let reason = Reason::TypeAcceptsMore;
    assert_disagrees(
        &validated_with_type_of(closed, open),
        keyword,
        place,
        reason,
    );
    assert_disagrees(&parsed_with_type_of(closed, open), keyword, place, reason);
    assert_validates_like(closed, "{} & Schema.Strict");
}

#[test]
fn required_name_needs_member() {
    let schema = r#"{ type: "object", required: ["a"] }"#;
    let reason = Reason::TypeAcceptsMore;
    let without_member = r#"{ type: "object" }"#;
    assert_disagrees(
        &validated_with_type_of(schema, without_member),
        "required",
        "#/required",
        reason,
    );
    let optional_member = r#"{ type: "object", properties: { a: {} } }"#;
    assert_disagrees(
        &parsed_with_type_of(schema, optional_member),
        "required",
        "#/required",
        reason,
    );
    assert_parses_like(schema, "{ a: unknown }");
}

#[test]
fn required_member_of_live_value_cannot_be_undefined() {
    let schema = r#"{ type: "object", required: ["a"] }"#;
    assert_disagrees(
        &validated(schema),
        "required",
        "#/required",
        Reason::TypeAcceptsMore,
    );
}

#[test]
fn schema_of_additional_properties_needs_index_signature() {
    let schema = r#"{ type: "object", properties: { a: { type: "string" } }, additionalProperties: { type: "number" } }"#;
    let without_signature = r#"{ type: "object", properties: { a: { type: "string" } } }"#;
    assert_disagrees(
        &validated_with_type_of(schema, without_signature),
        "additionalProperties",
        "#/additionalProperties",
        Reason::TypeAcceptsMore,
    );
}

#[test]
fn unique_items_needs_its_rule() {
    let schema = r#"{ type: "array", uniqueItems: true }"#;
    assert_disagrees(
        &validated_with_type_of(schema, r#"{ type: "array" }"#),
        "uniqueItems",
        "#/uniqueItems",
        Reason::TypeAcceptsMore,
    );
    assert_validates_like(schema, "unknown[] & Schema.UniqueItems");
}

#[test]
fn schemas_by_position_need_tuple() {
    let schema = r#"{ type: "array", prefixItems: [{ type: "string" }] }"#;
    let (keyword, place) = ("type", "#/prefixItems/0/type");
    let list = r#"{ type: "array" }"#;
    let reason = Reason::TypeAcceptsWhatIsNotJson;
    assert_disagrees(
        &validated_with_type_of(schema, list),
        keyword,
        place,
        reason,
    );
    assert_disagrees(&parsed_with_type_of(schema, list), keyword, place, reason);
    assert_validates_like(schema, "[string?, ...unknown[]]");
}

#[test]
fn one_of_is_not_any_of() {
    let arms = r#"[{ type: "number", minimum: 1 }, { type: "number", maximum: 5 }]"#;
    let one_of = format!("{{ oneOf: {arms} }}");
    let any_of = format!("{{ anyOf: {arms} }}");
    assert_disagrees(
        &validated_with_type_of(&one_of, &any_of),
        "minimum",
        "#/oneOf/0/minimum",
        Reason::TypeAcceptsMore,
    );
    assert_validates_like(
        &one_of,
        "(string | number | boolean | unknown[] | Record<never, never>) & Schema.OneOf<[number & Schema.Min<1>, number & Schema.Max<5>]>",
    );
}

#[test]
fn counts_of_properties_need_their_rules() {
    let open = r#"{ type: "object" }"#;
    let reason = Reason::TypeAcceptsMore;
    let least = r#"{ type: "object", minProperties: 1 }"#;
    assert_disagrees(
        &validated_with_type_of(least, open),
        "minProperties",
        "#/minProperties",
        reason,
    );
    assert_validates_like(least, "Record<never, never> & Schema.MinProperties<1>");
    let most = r#"{ type: "object", maxProperties: 2 }"#;
    assert_disagrees(
        &validated_with_type_of(most, open),
        "maxProperties",
        "#/maxProperties",
        reason,
    );
    assert_disagrees(
        &validated_with_type_of(most, r#"{ type: "object", maxProperties: 3 }"#),
        "maxProperties",
        "#/maxProperties",
        reason,
    );
}

#[test]
fn keyword_beside_reference_counts() {
    let schema = r##"{ $defs: { a: { type: "number" } }, $ref: "#/$defs/a", minimum: 1 }"##;
    let without_minimum = r##"{ $defs: { a: { type: "number" } }, $ref: "#/$defs/a" }"##;
    assert_disagrees(
        &validated_with_type_of(schema, without_minimum),
        "minimum",
        "#/minimum",
        Reason::TypeAcceptsMore,
    );
    assert_validates_like(
        schema,
        "(string | (number & Schema.Min<1>) | boolean | unknown[] | Record<never, never>) & Schema.AllOf<[number]>",
    );
}

#[test]
fn keyword_beside_reference_of_draft_7_is_refused() {
    let schema = r##"{ $schema: "http://json-schema.org/draft-07/schema#", definitions: { a: { type: "number" } }, $ref: "#/definitions/a", minimum: 1 }"##;
    assert_has_no_translation(&validated(schema), "validate", "$ref at #");
    for other in [r#"{ type: "number" }"#, r#"{ type: "number", minimum: 1 }"#] {
        assert_disagrees(
            &validated_with_type_of(schema, other),
            "minimum",
            "#/minimum",
            Reason::StandsBesideReference,
        );
    }
}

#[test]
fn type_cannot_refuse_valid_value() {
    assert_disagrees(
        &validated_with_type_of(r#"{ type: "number" }"#, r#"{ type: "integer" }"#),
        "type",
        "#",
        Reason::TypeRefusesMore,
    );
    assert_disagrees(
        &validated_with_type_of(r#"{ type: ["string", "null"] }"#, r#"{ type: "string" }"#),
        "schema",
        "#",
        Reason::TypeRefusesMore,
    );
}

#[test]
fn pattern_of_schema_has_unicode_flag() {
    for source in ["^[^@]+@{0,1}[^@]+$", "(?<![a-z])(?![a-z])"] {
        let schema = format!("{{ type: \"string\", pattern: \"{source}\" }}");
        // The type of a constant is taken as it is, with the rule that stands beside it.
        let validated_as_constant = |flags: &str| {
            let text = format!("`${{string}}@${{string}}` & Schema.Pattern<\"{source}\"{flags}>");
            let ty = format!("{{ readonly const: {text} }}");
            probe(
                &declare_schema_cast_to(&schema, &ty),
                &validate_as(SCHEMA_TYPE),
            )
        };
        assert_disagrees(
            &validated_as_constant(""),
            "pattern",
            "#/pattern",
            Reason::TypeAcceptsMore,
        );
        assert_disagrees(
            &validated_as_constant(", \"u\""),
            "type",
            "#",
            Reason::TypeRefusesMore,
        );
    }
    assert_validates_like(
        r#"{ type: "string", pattern: "^[^@]+@{0,1}[^@]+$" }"#,
        r#"string & Schema.Pattern<"^[^@]+@{0,1}[^@]+$", "u">"#,
    );
}

#[test]
fn optional_member_that_holds_undefined_is_key_to_additional_properties() {
    let schema = r#"{ type: "object", allOf: [{ properties: { x: { type: "number" } } }, { additionalProperties: { type: "number" } }] }"#;
    let other = r#"{ type: "object", properties: { x: { type: "number" } }, additionalProperties: { type: "number" } }"#;
    assert_disagrees(
        &validated_with_type_of(schema, other),
        "additionalProperties",
        "#/allOf/1/additionalProperties",
        Reason::TypeAcceptsMore,
    );
    assert_compiles_like(
        &declare_schema_typed_as(schema, other),
        parse_as,
        "{ x?: number; [key: string]: number }",
    );
}

#[test]
fn type_cannot_fill_default() {
    // The type of a constant is taken as it is, with the rule that stands beside it.
    let filled = r#"{ readonly type: "object"; readonly properties: { readonly a: { readonly const: 5 & Schema.Default<5> } }; readonly required: readonly ["a"] }"#;
    let any = r#"{ readonly type: "object"; readonly required: readonly ["a"] }"#;
    let either = format!("{{ readonly anyOf: readonly [{any}, {filled}] }}");
    let required = r#"{ type: "object", required: ["a"] }"#;
    assert_disagrees(
        &probe(
            &declare_schema_cast_to(required, &either),
            &parse_as(SCHEMA_TYPE),
        ),
        "default",
        "#",
        Reason::TypeFillsDefault,
    );
}

#[test]
fn number_that_no_json_text_holds_is_not_read() {
    let number = r#"{ type: "number" }"#;
    assert_has_no_translation(&parsed("{ const: 1e999 }"), "JSON.parse", "const at #");
    assert_not_read(&parsed_with_type_of("{ const: 1e999 }", number));
    assert_not_read(&parsed_with_type_of(
        r#"{ type: "number", maximum: 1e999 }"#,
        number,
    ));
    assert_not_read(&parsed_with_type_of("{ enum: [0, -1e999] }", number));
}

#[test]
fn nullable_is_no_keyword() {
    let schema = r#"{ type: "string", nullable: true }"#;
    assert_has_no_translation(&validated(schema), "validate", "nullable at #");
    assert_disagrees(
        &validated_with_type_of(schema, r#"{ type: ["string", "null"] }"#),
        "nullable",
        "#/nullable",
        Reason::IsNotKnown,
    );
}

#[test]
fn unknown_keyword_is_refused_where_nothing_refers_to_it() {
    let schema = r#"{ type: "string", $defs: { unused: { frobnicate: 1 } } }"#;
    assert_has_no_translation(
        &validated(schema),
        "validate",
        "frobnicate at #/$defs/unused",
    );
    assert_disagrees(
        &validated_with_type_of(schema, r#"{ type: "string" }"#),
        "frobnicate",
        "#/$defs/unused/frobnicate",
        Reason::IsNotKnown,
    );
}

#[test]
fn keyword_of_another_class_is_read() {
    let text = r#"{ type: "string" }"#;
    let schema = r#"{ type: "string", minimum: "5" }"#;
    assert_has_no_translation(&validated(schema), "validate", "minimum at #");
    assert_disagrees(
        &validated_with_type_of(schema, text),
        "minimum",
        "#/minimum",
        Reason::IsMalformed,
    );
    assert_disagrees(
        &validated_with_type_of(r#"{ not: { type: "text" } }"#, text),
        "type",
        "#/not/type",
        Reason::IsNotKnown,
    );
}

#[test]
fn schema_is_compared_behind_alias_and_below_root() {
    let schema = declare_schema_typed_as(
        r#"{ type: "object", minProperties: 1 }"#,
        r#"{ type: "object" }"#,
    );
    let declarations = format!("{schema}\ntype Row = {SCHEMA_TYPE};");
    let page = format!("{declarations}\ninterface Page {{ first: Row | null }}");
    for body in [
        probe(&declarations, &validate_as("Row")),
        probe(&declarations, &validate_as("{ rows: Row[] }")),
        probe(&page, &parse_as("Page")),
        probe(&declarations, &validate_as("Record<string, Row>")),
    ] {
        assert_disagrees(
            &body,
            "minProperties",
            "#/minProperties",
            Reason::TypeAcceptsMore,
        );
    }
}

#[test]
fn schema_that_is_not_written_out_is_not_read() {
    let text = declare_schema(r#"{ type: "string" }"#);
    assert_not_read(&probe(
        "",
        &validate_as(r#"Schema.FromJSONSchema<{ type: "string" }>"#),
    ));
    assert_not_read(&probe(
        "let schema = { type: \"string\" } as const;\nschema = { type: \"string\" };",
        &validate_as(SCHEMA_TYPE),
    ));
    assert_not_read(&probe(
        "declare const schema: { type: \"string\" };",
        &validate_as(SCHEMA_TYPE),
    ));
    assert_not_read(&probe(
        &format!("{text}\ntype Of<S> = Schema.FromJSONSchema<S>;"),
        &validate_as("Of<typeof schema>"),
    ));
}

#[test]
fn schema_type_that_depends_on_type_parameter_is_not_read() {
    let alias = "type With<Documents> = Schema.FromJSONSchema<typeof schema, Documents>;";
    let reference = declare_schema(r#"{ $ref: "urn:text" }"#);
    assert_not_read(&probe(
        &format!("{reference}\n{alias}"),
        &validate_as(r#"With<{ "urn:text": { type: "string" } }>"#),
    ));
}

#[test]
fn variable_that_is_never_assigned_is_read() {
    assert_compiles_like(
        "let schema = { type: \"string\" } as const;",
        validate_as,
        "string",
    );
}

#[test]
fn parts_of_translation_cannot_be_named() {
    assert_not_read(&probe(
        &declare_schema(r#"{ type: "string" }"#),
        &validate_as("Schema.JSONSchema.Whole<typeof schema, {}>"),
    ));
}

#[test]
fn schema_type_in_intersection_is_refused() {
    let schema = declare_schema(
        r#"{ type: "object", properties: { a: { type: "number" } }, additionalProperties: false }"#,
    );
    let declarations = format!("{schema}\ntype Row = {SCHEMA_TYPE};");
    assert_not_compiled(
        &probe(&declarations, &validate_as("Row & { b: string }")),
        IS_INTERSECTED,
    );
    assert_compiles_like(&schema, validate_as, "{ a?: number } & Schema.Strict");
}

#[test]
fn negated_schema_type_must_accept_every_valid_live_value() {
    let schema = declare_schema("{ const: { a: 1 } }");
    let declarations = format!("{schema}\ntype One = {SCHEMA_TYPE};");
    let negated = "{ a: number } & Schema.Not<One>";
    assert_compiles_like(&schema, validate_as, "{ a: 1 } & Schema.DeepStrict");
    assert_disagrees(
        &probe(&declarations, &validate_as(negated)),
        "schema",
        "#",
        Reason::TypeRefusesMore,
    );
    let lowered = lower(&probe(&declarations, &parse_as(negated)));
    assert_eq!(collect_diagnostics(&lowered), []);
    assert_eq!(lowered.fragment.expected_results.len(), 1);
}
