use bstr::{BStr, BString};
use bun_core::strings::split;

use crate::compile::testing::{default_settings, lower_program_with_settings};
use crate::diagnostic_codes::Code;
use crate::lower::LoweredFile;
use bun_sema::check::aot::BRAND_KEYS;

const BUN_TYPES: &str = r#"declare module "bun" {
  type int32 = number & { readonly "bun.int32"?: true };
  namespace Schema {
    type Int = { readonly "bun.int"?: true };
    type Min<N extends number> = { readonly "bun.min"?: N };
    type Max<N extends number> = { readonly "bun.max"?: N };
    type Above<N extends number> = { readonly "bun.above"?: N };
    type Below<N extends number> = { readonly "bun.below"?: N };
    type MultipleOf<N extends number> = { readonly "bun.multipleOf"?: N };
    type MinLength<N extends number> = { readonly "bun.minLength"?: N };
    type MaxLength<N extends number> = { readonly "bun.maxLength"?: N };
    type MinItems<N extends number> = { readonly "bun.minItems"?: N };
    type MaxItems<N extends number> = { readonly "bun.maxItems"?: N };
    type Pattern<P extends string, Flags extends "" | "u" = ""> = { readonly "bun.pattern"?: [P, Flags] };
    type Format<S extends "email" | "uuid" | "ipv4" | "ipv6" | "date" | "date-time" | "url" | "time" | "duration" | "hostname" | "uri" | "uri-reference" | "regex" | "json-pointer" | "relative-json-pointer"> = { readonly "bun.format"?: S };
    type Message<S extends string> = { readonly "bun.message"?: S };
    type Default<V extends string | number | boolean | null> = { readonly "bun.default"?: V };
    type Strict = { readonly "bun.strict"?: true };
    type DeepStrict = { readonly "bun.strict"?: "deep" };
    type UniqueItems = { readonly "bun.uniqueItems"?: true };
    type Contains<T, Min extends number = 1, Max extends number = never> = { readonly "bun.contains"?: [T, Min, Max] };
    type Not<T> = { readonly "bun.not"?: [T] };
    type If<C, T = unknown, E = unknown> = { readonly "bun.if"?: [C, T, E] };
    type OneOf<A extends unknown[]> = { readonly "bun.oneOf"?: A };
    type AllOf<A extends unknown[]> = { readonly "bun.allOf"?: A };
    type PatternProperties<P extends Record<string, unknown>, Others = unknown> = { readonly "bun.patternProperties"?: [P, Others] };
    type PropertyNames<T> = { readonly "bun.propertyNames"?: [T] };
    type MinProperties<N extends number> = { readonly "bun.minProperties"?: N };
    type MaxProperties<N extends number> = { readonly "bun.maxProperties"?: N };
    type DependentRequired<D extends Record<string, string[]>> = { readonly "bun.dependentRequired"?: D };
    type DependentSchemas<D extends Record<string, unknown>> = { readonly "bun.dependentSchemas"?: D };
    type Refused<K extends string> = { readonly "bun.refused"?: K };
  }
  const JSON: JSON;
  interface JSON extends globalThis.JSON {
    parse<T = any>(text: string, reviver?: (this: any, key: string, value: any) => any): T;
    parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
  }
}
declare module "bun:bundle" {
  function validate<T>(value: unknown): T;
}
"#;

pub(in crate::lower::validate) const HEADER: &str = "/// <reference path=\"./bun-declarations.d.ts\" />\n\
    import { JSON, type Schema, type int32 } from \"bun\";\n\
    import { validate } from \"bun:bundle\";\n";

const MISUSE_DECLARATIONS: &str = "interface ProbePoint { x: number }\n\
    declare const v: unknown;\n\
    declare const list: unknown[];\n\
    declare function probeUse(value: unknown): void;\n";

fn lower_entry_point(files: &[(&str, &str)]) -> LoweredFile {
    let mut lowered = lower_program_with_settings(files, &default_settings());
    assert_eq!(lowered.len(), 1, "only the entry point has code");
    lowered.remove(0).1
}

pub(in crate::lower::validate) fn lower_main(main: &str) -> LoweredFile {
    lower_entry_point(&[("main.ts", main), ("bun-declarations.d.ts", BUN_TYPES)])
}

pub(in crate::lower::validate) fn collect_diagnostics(
    lowered: &LoweredFile,
) -> Vec<(Code, Vec<BString>)> {
    let diagnostics = lowered.diagnostics.iter();
    diagnostics
        .map(|diagnostic| {
            let arguments = diagnostic.arguments.iter();
            let arguments = arguments.map(|argument| BString::from(argument.as_slice()));
            (diagnostic.code, arguments.collect())
        })
        .collect()
}

pub(in crate::lower::validate) fn unsupported_arguments(body: &str) -> Vec<BString> {
    let lowered = lower_main(&format!("{HEADER}{body}"));
    assert!(lowered.fragment.expected_results.is_empty(), "{body}");
    let mut found = collect_diagnostics(&lowered);
    assert_eq!(found.len(), 1, "{body}: {found:?}");
    let (code, arguments) = found.remove(0);
    assert_eq!(code, Code::UnsupportedValidationType, "{body}");
    arguments
}

fn reported_codes(lowered: &LoweredFile) -> Vec<Code> {
    let diagnostics = lowered.diagnostics.iter();
    diagnostics.map(|diagnostic| diagnostic.code).collect()
}

fn lower_misuse(line: &str) -> LoweredFile {
    lower_main(&format!("{HEADER}{MISUSE_DECLARATIONS}{line}\n"))
}

/// A text without its white space, and without what the formatter adds where it spreads an alias over lines.
fn squeeze(text: &[u8]) -> Vec<u8> {
    let mut squeezed: Vec<u8> = Vec::with_capacity(text.len());
    for &byte in text.iter().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'|' && squeezed.ends_with(b"extends") {
            continue;
        }
        let closes_list = byte == b'>' && squeezed.ends_with(b",");
        let closes_members = byte == b'}' && squeezed.ends_with(b";");
        if closes_list || closes_members {
            squeezed.pop();
        }
        squeezed.push(byte);
    }
    squeezed
}

#[test]
fn declarations_match_bun_types() {
    let published: [&[u8]; 3] = [
        include_bytes!("../../../../../packages/bun-types/bun.d.ts"),
        include_bytes!("../../../../../packages/bun-types/globals.d.ts"),
        include_bytes!("../../../../../packages/bun-types/bundle.d.ts"),
    ];
    let published = published.map(squeeze);
    let declarations: Vec<&[u8]> = split(BUN_TYPES.as_bytes(), b"\n")
        .map(<[u8]>::trim_ascii)
        .filter(|line| line.ends_with(b";"))
        .collect();
    assert_eq!(declarations.len(), 34);
    for declaration in declarations {
        // The last `;` of a block is one that `squeeze` drops.
        let squeezed = squeeze(declaration.strip_suffix(b";").unwrap_or(declaration));
        let is_published = published
            .iter()
            .any(|text| text.windows(squeezed.len()).any(|part| part == squeezed));
        assert!(is_published, "not published: {}", BStr::new(declaration));
    }
}

#[test]
fn every_brand_key_of_the_declarations_is_known() {
    let mut declared: Vec<&BStr> = split(BUN_TYPES.as_bytes(), b"\"")
        .filter(|text| text.starts_with(b"bun."))
        .map(BStr::new)
        .collect();
    declared.sort_unstable();
    declared.dedup();
    let mut known: Vec<&BStr> = BRAND_KEYS.iter().copied().map(BStr::new).collect();
    known.sort_unstable();
    assert_eq!(declared, known);
}

#[test]
fn rule_beside_null_or_undefined_is_reported() {
    let lost = [
        r#"type Lost = (null | "") & Schema.Message<"must not be empty">;"#,
        r#"type Lost = null & Schema.Message<"never">;"#,
        "type Lost = (string | undefined) & Schema.MinLength<1>;",
        "type Lost = Schema.MinLength<1> & (string | null);",
        "type Maybe = string | null;\ntype Lost = Maybe & Schema.MinLength<1>;",
        "type Short = string & Schema.MaxLength<3>;\ntype Lost = (string | null) & Short;",
        "type Lost = ({ a: number } | null) & Schema.Strict;",
        "type Lost = string & Schema.Not<(null | \"\") & Schema.Message<\"empty\">>;\nvalidate<Lost>(v);",
        "type Lost = string & Schema.If<null & Schema.Message<\"none\">, never>;\nvalidate<Lost>(v);",
    ];
    for line in lost {
        assert_eq!(
            reported_codes(&lower_misuse(line)),
            [Code::RuleBesideNullish],
            "{line}"
        );
    }
    let found = collect_diagnostics(&lower_misuse(
        r#"type Lost = null & Schema.Message<"never">;"#,
    ));
    let text = BString::from(r#"null & Schema.Message<"never">"#);
    assert_eq!(found, [(Code::RuleBesideNullish, vec![text])]);
}

#[test]
fn null_and_undefined_outside_the_intersection_are_accepted() {
    let kept = [
        "type Kept = (string & Schema.MinLength<1>) | null;",
        "type Kept = { a: string | null; b?: number } & Schema.Strict;",
        "type Kept = string & Schema.MinLength<1> & Schema.MaxLength<3>;",
        "type Kept = (string | null) & {};",
        "type Kept = ({ a: number } | null) & { b: number };",
        "validate<(string & Schema.MinLength<1>) | null | undefined>(v);",
    ];
    for line in kept {
        let codes = reported_codes(&lower_misuse(line));
        assert!(codes.is_empty(), "{line}: {codes:?}");
    }
}

#[test]
fn error_type_behind_a_type_argument_is_reported() {
    let hidden = [
        (
            "// @ts-expect-error\nvalidate<Missing>(v);",
            Code::ValidationTypeIsAny,
            vec!["Missing"],
        ),
        (
            "// @ts-expect-error\nvalidate<{ id: number; owner: Missing }>(v);",
            Code::ValidationTypeIsAny,
            vec!["{ id: number; owner: Missing }"],
        ),
        (
            "// @ts-expect-error\nJSON.parse<Missing[]>(\"[]\");",
            Code::UnsupportedValidationType,
            vec!["JSON.parse", "Missing[]", "[number]: Missing"],
        ),
        (
            "// @ts-expect-error\ntype Name = string & Schema.Not<Banned>;\nvalidate<Name>(v);",
            Code::RefusedValidationRule,
            vec!["validate", "Not"],
        ),
    ];
    for (lines, code, arguments) in hidden {
        let lowered = lower_misuse(lines);
        assert!(lowered.fragment.expected_results.is_empty(), "{lines}");
        let arguments = arguments.into_iter().map(BString::from).collect();
        assert_eq!(
            collect_diagnostics(&lowered),
            [(code, arguments)],
            "{lines}"
        );
    }
}

#[test]
fn misuse_is_reported() {
    let misuses = [
        (r#"JSON.parse("1");"#, Code::TypedParseNeedsTypeArgument),
        ("validate(v);", Code::ValidateNeedsTypeArgument),
        ("validate<ProbePoint>();", Code::ValidateArgumentCount),
        ("validate<ProbePoint>(v, v);", Code::ValidateArgumentCount),
        (
            "validate<ProbePoint>(...list);",
            Code::ValidateArgumentCount,
        ),
        ("validate?.<ProbePoint>(v);", Code::ValidateOptionalCall),
        ("const f = validate;", Code::ValidateIsNotAValue),
        ("probeUse(validate);", Code::ValidateIsNotAValue),
        ("probeUse(typeof validate);", Code::ValidateIsNotAValue),
        ("probeUse({ validate });", Code::ValidateIsNotAValue),
        ("export { validate };", Code::ValidateIsNotAValue),
        ("export default validate;", Code::ValidateIsNotAValue),
        ("export { JSON };", Code::JsonFromBunIsExported),
    ];
    for (line, code) in misuses {
        assert_eq!(reported_codes(&lower_misuse(line)), [code], "{line}");
    }
}

#[test]
fn correct_calls_are_accepted() {
    let calls = [
        "validate<ProbePoint>(v);",
        r#"JSON.parse<ProbePoint>("{}");"#,
        "function probeOuter() { return function () { return validate<ProbePoint>(v); }; }",
        "export type { Schema };",
        "const other = 1;\nexport { other };",
    ];
    for line in calls {
        let codes = reported_codes(&lower_misuse(line));
        assert!(codes.is_empty(), "{line}: {codes:?}");
    }
}

#[test]
fn every_misused_mention_is_reported() {
    let lines = "probeUse(validate);\n\
        probeUse(validate<ProbePoint>(v));\n\
        const f = validate;";
    let lowered = lower_misuse(lines);
    assert_eq!(
        reported_codes(&lowered),
        [Code::ValidateIsNotAValue, Code::ValidateIsNotAValue]
    );
}

#[test]
fn type_parameter_is_reported_by_name() {
    let generic = "function probeGeneric<T>(x: unknown) { return validate<T>(x); }";
    let found = collect_diagnostics(&lower_misuse(generic));
    assert_eq!(
        found,
        [(Code::ValidationTypeParameter, vec![BString::from("T")])]
    );
}

#[test]
fn validate_needs_typescript() {
    let untyped = "import { validate } from \"bun:bundle\";\nvalidate(1);\n";
    let lowered = lower_entry_point(&[("main.js", untyped)]);
    assert_eq!(reported_codes(&lowered), [Code::ValidateNeedsTypeScript]);
}

#[test]
fn unsupported_type_names_member() {
    assert_eq!(
        unsupported_arguments(
            r#"interface Meeting { title: string; when: Date } JSON.parse<Meeting>("{}");"#
        ),
        ["JSON.parse", "Meeting", "when: Date"]
    );
    let nested = unsupported_arguments(
        r#"interface Handler { name: string; steps: { run: () => void }[] } JSON.parse<Handler>("{}");"#,
    );
    assert_eq!(nested[2], "steps[number].run: () => void");
    assert_eq!(
        unsupported_arguments(r#"JSON.parse<{ id: symbol }>("{}");"#),
        ["JSON.parse", "{ id: symbol; }", "id: symbol"]
    );
    let tuple = unsupported_arguments(r#"JSON.parse<[...string[], number]>("[]");"#);
    assert_eq!(tuple[1], "[...string[], number]");
    assert_eq!(tuple[2], "[...string[], number]");
    assert_eq!(
        unsupported_arguments("validate<{ run: () => void }>({});"),
        ["validate", "{ run: () => void; }", "run: () => void"]
    );
}

#[test]
fn global_parse_without_type_argument_is_ordinary() {
    let lowered = lower_main("globalThis.JSON.parse(\"1\");\nJSON.parse(\"1\");\n");
    assert!(lowered.diagnostics.is_empty());
    assert!(lowered.fragment.expected_results.is_empty());
}

#[test]
fn unresolved_typed_parse_is_reported() {
    let body = "function pick<T>(x: T) { return x; }\npick(JSON).parse<{ a: number }>(\"{}\");\n";
    let lowered = lower_main(&format!("{HEADER}{body}"));
    assert_eq!(
        reported_codes(&lowered),
        [Code::TypedParseCalleeIsNotResolved]
    );
    let [expected] = &lowered.fragment.expected_results[..] else {
        panic!("{:?}", lowered.fragment.expected_results);
    };
    assert!(!expected.validation.is_empty());
}

#[test]
fn parse_held_under_another_signature_validates_by_what_that_answers() {
    let body = "const parse: <T>(text: string) => T = JSON.parse;\nparse<{ a: number }>(\"{}\");\n";
    let lowered = lower_main(&format!("{HEADER}{body}"));
    assert!(lowered.diagnostics.is_empty());
    let [expected] = &lowered.fragment.expected_results[..] else {
        panic!("{:?}", lowered.fragment.expected_results);
    };
    assert!(!expected.validation.is_empty());
}

#[test]
fn parse_held_in_constant_validates_by_its_own_signature() {
    let body = "const parse = JSON.parse;\nparse<{ a: number }>(\"{}\");\n";
    let lowered = lower_main(&format!("{HEADER}{body}"));
    assert!(lowered.diagnostics.is_empty());
    let [expected] = &lowered.fragment.expected_results[..] else {
        panic!("{:?}", lowered.fragment.expected_results);
    };
    assert!(!expected.validation.is_empty());
}
