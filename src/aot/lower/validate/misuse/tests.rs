use bstr::{BStr, BString};
use bun_core::strings::split;

use crate::compile::testing::{default_settings, lower_program_with_settings};
use crate::diagnostic_codes::Code;
use crate::lower::LoweredFile;

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
    type Pattern<S extends string> = { readonly "bun.pattern"?: S };
    type Format<S extends "email" | "uuid" | "ipv4" | "ipv6" | "date" | "date-time" | "url"> = { readonly "bun.format"?: S };
    type Message<S extends string> = { readonly "bun.message"?: S };
    type Default<V extends string | number | boolean | null> = { readonly "bun.default"?: V };
    type Strict = { readonly "bun.strict"?: true };
    type DeepStrict = { readonly "bun.strict"?: "deep" };
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

#[test]
fn declarations_match_bun_types() {
    let published: [&[u8]; 3] = [
        include_bytes!("../../../../../packages/bun-types/bun.d.ts"),
        include_bytes!("../../../../../packages/bun-types/globals.d.ts"),
        include_bytes!("../../../../../packages/bun-types/bundle.d.ts"),
    ];
    let published_lines: Vec<&[u8]> = published
        .into_iter()
        .flat_map(|text| split(text, b"\n"))
        .map(<[u8]>::trim_ascii)
        .collect();
    let declarations: Vec<&[u8]> = split(BUN_TYPES.as_bytes(), b"\n")
        .map(<[u8]>::trim_ascii)
        .filter(|line| line.ends_with(b";"))
        .collect();
    assert_eq!(declarations.len(), 21);
    for declaration in declarations {
        let is_published = published_lines.contains(&declaration);
        assert!(is_published, "not published: {}", BStr::new(declaration));
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
    let tuple = unsupported_arguments(r#"JSON.parse<[string, number?]>("[]");"#);
    assert_eq!(tuple[1], "[string, (number | undefined)?]");
    assert_eq!(tuple[2], "[string, (number | undefined)?]");
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
fn type_argument_of_another_signature_asks_for_no_validation() {
    let body = "const parse: <T>(text: string) => T = JSON.parse;\nparse<{ a: number }>(\"{}\");\n";
    let lowered = lower_main(&format!("{HEADER}{body}"));
    assert!(lowered.diagnostics.is_empty());
    for expected in &lowered.fragment.expected_results {
        assert!(expected.validation.is_empty());
    }
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
