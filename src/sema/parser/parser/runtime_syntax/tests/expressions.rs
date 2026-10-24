use super::*;
use bun_sema::atom::known;

fn tags_and_flags(file: &FileBuilder) -> Vec<(ExprTag, ExprFlags)> {
    let tags = file.exprs.iter().map(|expr| expr.kind.tag());
    tags.zip(file.expr_flags.iter().copied()).collect()
}

fn flags_by_tag(text: &str, tag: ExprTag) -> Vec<ExprFlags> {
    let (file, _) = parsed(text, typescript());
    let mut all = tags_and_flags(&file);
    all.retain(|it| it.0 == tag);
    all.into_iter().map(|it| it.1).collect()
}

#[test]
fn flags_follow_syntax() {
    let none = ExprFlags::empty();
    let link = ExprFlags::OPTIONAL_CHAIN_LINK;
    let bracket = ExprFlags::BRACKET_ACCESS;
    let private = ExprFlags::PRIVATE_NAME;
    let parenthesized = ExprFlags::PARENTHESIZED;
    let class = "class A { #x; m() { this.#x; #x in this } }";
    let cases: &[(&str, ExprTag, &[ExprFlags])] = &[
        ("a?.b.c", ExprTag::Dot, &[link, none]),
        ("(a?.b).c", ExprTag::Dot, &[link | parenthesized, none]),
        ("a.b", ExprTag::Dot, &[none]),
        ("a?.[0]", ExprTag::Index, &[bracket | link]),
        ("a[0]", ExprTag::Index, &[bracket]),
        ("a?.()", ExprTag::Call, &[link]),
        ("a?.b()", ExprTag::Call, &[none]),
        ("a()", ExprTag::Call, &[none]),
        (class, ExprTag::Dot, &[private]),
        (class, ExprTag::PrivateIdentifier, &[private]),
        ("x = \"#x\"", ExprTag::String, &[none]),
        ("`x`", ExprTag::String, &[ExprFlags::TEMPLATE_LITERAL]),
        ("f`x`", ExprTag::String, &[ExprFlags::TEMPLATE_LITERAL]),
        ("x = \"x\"", ExprTag::String, &[none]),
    ];
    for &(text, tag, expected) in cases {
        assert_eq!(flags_by_tag(text, tag), expected, "{text}");
    }
}

#[test]
fn column_survives_speculation_and_removal() {
    let none = ExprFlags::empty();
    let parenthesized = ExprFlags::PARENTHESIZED;
    let name = (ExprTag::Ident, none);
    let cases: &[(&str, &[(ExprTag, ExprFlags)])] = &[
        ("(a, b)", &[name, name, (ExprTag::Binary, parenthesized)]),
        ("(a, b) => c", &[name, (ExprTag::Fn, none)]),
        ("a < b > (c)", &[name, name, (ExprTag::Call, none)]),
        ("l: x", &[name]),
        (
            "({ [\"k\"]: 1 })",
            &[(ExprTag::Number, none), (ExprTag::Object, parenthesized)],
        ),
        ("new A<T>()", &[name, (ExprTag::New, none)]),
        ("x => y", &[name, (ExprTag::Fn, none)]),
    ];
    for &(text, expected) in cases {
        let (file, _) = parsed(text, typescript());
        assert_eq!(tags_and_flags(&file), expected, "{text}");
    }
}

fn regex_atoms(file: &FileBuilder) -> (Atom, Atom) {
    let [regex] = file.exprs[..] else {
        panic!("{:?}", file.exprs);
    };
    let ExprKind::Regex { pattern, flags } = regex.kind else {
        panic!("{regex:?}");
    };
    (pattern, flags)
}

#[test]
fn regex() {
    let text = r"/a\/[/]b/gi";
    let (file, scratch) = parsed(text, typescript());
    let atoms = scratch.atoms(text.as_bytes());
    let (pattern, flags) = regex_atoms(&file);
    assert_eq!(atom_text(&atoms, pattern), r"a\/[/]b");
    assert_eq!(atom_text(&atoms, flags), "gi");

    let text = "/=a/";
    let (file, scratch) = parsed(text, typescript());
    let atoms = scratch.atoms(text.as_bytes());
    let (pattern, flags) = regex_atoms(&file);
    assert_eq!(atom_text(&atoms, pattern), "=a");
    assert_eq!(flags, known::empty);
}

fn part_texts<'a>(file: &FileBuilder, atoms: &'a FileAtoms<'_>) -> Vec<(Option<&'a str>, &'a str)> {
    let text = |atom| atom_text(atoms, atom);
    let parts = file.template_parts.iter();
    parts
        .map(|part| (part.cooked.map(text), text(part.raw)))
        .collect()
}

#[test]
fn template_parts_are_recorded() {
    let text = "`a${b}c`";
    let (file, scratch) = parsed(text, typescript());
    let atoms = scratch.atoms(text.as_bytes());
    let expected = [(Some("a"), "a"), (Some("c"), "c")];
    assert_eq!(part_texts(&file, &atoms), expected);
    let [(template, 0)] = file.template_part_starts[..] else {
        panic!("{:?}", file.template_part_starts);
    };
    assert_eq!(file.exprs[template.idx()].kind.tag(), ExprTag::Template);

    let text = "f`\\unicode${`n${1}`}`";
    let (file, scratch) = parsed(text, typescript());
    let atoms = scratch.atoms(text.as_bytes());
    let expected = [
        (Some("n"), "n"),
        (Some(""), ""),
        (None, "\\unicode"),
        (Some(""), ""),
    ];
    assert_eq!(part_texts(&file, &atoms), expected);
    let [(inner, 0), (outer, 2)] = file.template_part_starts[..] else {
        panic!("{:?}", file.template_part_starts);
    };
    assert!(inner < outer);
    assert_eq!(file.template_parts(inner).len(), 2);
    assert_eq!(file.template_parts(outer).len(), 2);

    let text = "f`x`";
    let (file, scratch) = parsed(text, typescript());
    let atoms = scratch.atoms(text.as_bytes());
    assert_eq!(part_texts(&file, &atoms), [(Some("x"), "x")]);
    let [(template, 0)] = file.template_part_starts[..] else {
        panic!("{:?}", file.template_part_starts);
    };
    assert_eq!(file.exprs[template.idx()].kind.tag(), ExprTag::String);
    assert_eq!(file.expr_flags(template), ExprFlags::TEMPLATE_LITERAL);
    assert_eq!(file.tagged_templates[0].1, template);

    let (file, _) = parsed("`x`", typescript());
    assert!(file.template_part_starts.is_empty());
    assert!(file.template_parts.is_empty());
}

#[test]
fn raw_text_has_line_feeds() {
    let text = "`a\r\nb\\n${c}\rd`";
    let (file, scratch) = parsed(text, typescript());
    let atoms = scratch.atoms(text.as_bytes());
    let expected = [(Some("a\nb\n"), "a\nb\\n"), (Some("\nd"), "\nd")];
    assert_eq!(part_texts(&file, &atoms), expected);
}

#[test]
fn unclosed_syntax() {
    let recovering = Options {
        recovers: true,
        ..typescript()
    };
    for text in ["`a${b", "f`a${b"] {
        let (file, scratch) = parsed(text, recovering);
        let atoms = scratch.atoms(text.as_bytes());
        let expected = [(Some("a"), "a"), (Some(""), "")];
        assert_eq!(part_texts(&file, &atoms), expected, "{text}");
        let [(template, 0)] = file.template_part_starts[..] else {
            panic!("{:?}", file.template_part_starts);
        };
        assert_eq!(file.template_parts(template).len(), 2, "{text}");
    }
    let (file, _) = parsed("(a", recovering);
    let expected = [(ExprTag::Ident, ExprFlags::PARENTHESIZED)];
    assert_eq!(tags_and_flags(&file), expected);
}

#[test]
fn jsx() {
    let options = Options {
        is_jsx: true,
        ..typescript()
    };
    let text = "<a b=\"&amp;\">x &lt; y{\"s\"}</a>";
    let (file, scratch) = parsed(text, options);
    let atoms = scratch.atoms(text.as_bytes());
    let (mut texts, mut strings) = (Vec::new(), Vec::new());
    for expr in &file.exprs {
        match expr.kind {
            ExprKind::JsxText(text) => texts.push(atom_text(&atoms, text)),
            ExprKind::String(text) => strings.push(atom_text(&atoms, text)),
            _ => {}
        }
    }
    assert_eq!(texts, ["x < y"]);
    assert_eq!(strings, ["&amp;", "s"]);
    let [(value, decoded)] = file.jsx_attribute_texts[..] else {
        panic!("{:?}", file.jsx_attribute_texts);
    };
    assert_eq!(atom_text(&atoms, decoded), "&");
    let ExprKind::String(written) = file.exprs[value.idx()].kind else {
        panic!("{:?}", file.exprs[value.idx()]);
    };
    assert_eq!(atom_text(&atoms, written), "&amp;");

    let (file, _) = parsed("<a b=\"c\"/>", options);
    assert!(file.jsx_attribute_texts.is_empty());
}

fn errors_with_codes(text: &str, options: Options, codes: &[u32]) -> Vec<(u32, DiagnosticClass)> {
    let (file, _) = parsed(text, options);
    let errors = file.diagnostics.iter().map(|it| (it.code, it.class));
    errors.filter(|it| codes.contains(&it.0)).collect()
}

#[test]
fn checker_owns_strict_mode_target_errors() {
    let texts = [
        "delete x",
        "delete (x)",
        "eval = 1",
        "eval += 1",
        "arguments++",
        "--eval",
        "[eval] = a",
        "[[eval] = []] = a",
        "[...[arguments]] = a",
        "({ eval } = a)",
        "({ eval = 1 } = a)",
        "({ a: arguments = 1, ...eval } = b)",
        "for (eval in a);",
    ];
    for text in texts {
        let found = errors_with_codes(text, compiled_javascript(), &[1100, 1102]);
        assert!(found.is_empty(), "{text}");
        let strict_text = format!("\"use strict\"; {text}");
        let found = errors_with_codes(&strict_text, compiled_javascript(), &[1100, 1102]);
        assert!(found.is_empty(), "{strict_text}");
    }
}

#[test]
fn diagnostic_classes() {
    let private_name = "class A { #b; m(a) { a?.#b } }";
    let cases: &[(&str, Options, u32, DiagnosticClass)] = &[
        ("a?.b`t`", typescript(), 1358, DiagnosticClass::EarlyError),
        ("new.x", typescript(), 17012, DiagnosticClass::EarlyError),
        (
            private_name,
            compiled_javascript(),
            18030,
            DiagnosticClass::TypeScriptGrammar,
        ),
    ];
    for &(text, options, code, class) in cases {
        let found = errors_with_codes(text, options, &[code]);
        assert_eq!(found, [(code, class)], "{text}");
    }
}
