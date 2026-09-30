// The lowered table of each input against the tree that typescript-go 89d5d5b prints for it (testdata/*.tsgo.txt, made with `tsgoprobe tree -nojsdoc`).
use super::{LowerError, LowerErrorKind, LowerOptions, ParseDiagnostic, lower_source_file};
use crate::ast::stable::Arena;
use crate::ast::{
    Ast, File, FileBuilder, Frozen, IdAllocator, Kind, NodeId, NodeListId, Open, SlotType,
    SourceFileData,
};
use crate::core::{LanguageVariant, ScriptKind};
use crate::diagnostics::{self, MessageId};
use crate::stringutil::util::utf8;
use std::fmt::Write as _;

fn script_kind_of(name: &str) -> ScriptKind {
    let name = name.as_bytes();
    if name.ends_with(b".tsx") {
        ScriptKind::TSX
    } else if name.ends_with(b".ts") {
        ScriptKind::TS
    } else if name.ends_with(b".jsx") {
        ScriptKind::JSX
    } else {
        ScriptKind::JS
    }
}

// Why an input has no file.
#[derive(Debug)]
enum Failure {
    // Bun's parser did not start, or the source does not parse.
    Parse,
    Lower(LowerError),
    // The builder did not finish.
    Finish,
}

// Bun's parse of `contents` without a visit, lowered and frozen, with the parse diagnostics of the lowering.
fn lower(
    name: &str,
    contents: &[u8],
    ids: &IdAllocator,
) -> Result<(File, Vec<ParseDiagnostic>), Failure> {
    let script_kind = script_kind_of(name);
    let loader = match script_kind {
        ScriptKind::TSX => bun_ast::Loader::Tsx,
        ScriptKind::TS => bun_ast::Loader::Ts,
        ScriptKind::JSX => bun_ast::Loader::Jsx,
        _ => bun_ast::Loader::Js,
    };
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(name.as_bytes(), contents);
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.top_level_await = true;
    options.suppress_warnings_about_weird_code = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let Ok(parser) = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena)
    else {
        return Err(Failure::Parse);
    };
    let lowered = parser.parse_only(|parsed| {
        let mut builder = FileBuilder::new(contents);
        let options = LowerOptions {
            script_kind,
            is_declaration_file: false,
            force_module: false,
        };
        let lowered = lower_source_file(&mut builder, contents, parsed.stmts, options)
            .map_err(Failure::Lower)?;
        let data = SourceFileData {
            file_name: name.as_bytes().to_vec(),
            language_variant: if script_kind == ScriptKind::TS {
                LanguageVariant::STANDARD
            } else {
                LanguageVariant::JSX
            },
            script_kind,
            identifier_count: lowered.identifier_count,
            external_module_indicator: lowered.external_module_indicator,
            comment_directives: lowered.comment_directives,
            ..SourceFileData::default()
        };
        let file = builder
            .finish(lowered.root, data, ids)
            .ok_or(Failure::Finish)?;
        Ok((file, lowered.diagnostics))
    });
    match lowered {
        Ok(file) => file,
        Err(_) => Err(Failure::Parse),
    }
}

// strconv.QuoteToASCII
fn quote_to_ascii(text: &[u8], out: &mut String) {
    out.push('"');
    let mut rest = text;
    while let Some(&first) = rest.first() {
        let (rune, size) = utf8::decode_rune_in_string(rest);
        let size = size.max(1);
        match (rune, first) {
            (_, b'"') => out.push_str("\\\""),
            (_, b'\\') => out.push_str("\\\\"),
            (_, 0x07) => out.push_str("\\a"),
            (_, 0x08) => out.push_str("\\b"),
            (_, 0x0c) => out.push_str("\\f"),
            (_, b'\n') => out.push_str("\\n"),
            (_, b'\r') => out.push_str("\\r"),
            (_, b'\t') => out.push_str("\\t"),
            (_, 0x0b) => out.push_str("\\v"),
            (_, 0x20..=0x7e) => out.push(first as char),
            (_, 0x00..=0x1f | 0x7f) => {
                let _ = write!(out, "\\x{first:02x}");
            }
            (0xFFFD, _) if size == 1 => {
                let _ = write!(out, "\\x{first:02x}");
            }
            (rune, _) if rune < 0x10000 => {
                let _ = write!(out, "\\u{rune:04x}");
            }
            (rune, _) => {
                let _ = write!(out, "\\U{rune:08x}");
            }
        }
        rest = rest.get(size..).unwrap_or(&[]);
    }
    out.push('"');
}

// A text of an input or of a tree as a message shows it.
fn quoted(text: &[u8]) -> String {
    let mut out = String::new();
    quote_to_ascii(text, &mut out);
    out
}

fn dump_list(
    a: Ast<'_>,
    out: &mut String,
    label: &str,
    list: NodeListId,
    parent: NodeId,
    indent: usize,
) {
    let loc = a.list_loc(list);
    let nodes = a.nodes(list);
    let nodes = nodes.as_slice();
    let _ = writeln!(
        out,
        "{:indent$}.{label}: list [{},{}) n={}",
        "",
        loc.pos(),
        loc.end(),
        nodes.len()
    );
    for node in nodes {
        dump_node(a, out, "-", *node, parent, indent + 2);
    }
}

// One node as probe/zzprobe/tree/tree.go prints it: scalar members on its line, then its node and list members, each group in byte order of the member names.
fn dump_node(
    a: Ast<'_>,
    out: &mut String,
    label: &str,
    node: NodeId,
    parent: NodeId,
    indent: usize,
) {
    let _ = write!(
        out,
        "{:indent$}{label} {} [{},{}) f={:#x}",
        "",
        a.kind(node).string(),
        a.pos(node),
        a.end(node),
        a.flags(node).bits()
    );
    if a.parent(node) != parent {
        let actual = a.parent(node);
        if actual.is_nil() {
            out.push_str(" parent=nil");
        } else {
            let _ = write!(
                out,
                " parent={}[{},{})",
                a.kind(actual).string(),
                a.pos(actual),
                a.end(actual)
            );
        }
    }
    let Some((def, data)) = a.data_any(node) else {
        out.push('\n');
        return;
    };
    if a.kind(node) == Kind::SourceFile {
        out.push('\n');
        let view = a.as_source_file(node);
        dump_list(a, out, "Statements", view.statements, node, indent + 2);
        dump_node(
            a,
            out,
            ".EndOfFileToken:",
            view.end_of_file_token,
            node,
            indent + 2,
        );
        return;
    }
    let mut members: Vec<(usize, &str, SlotType)> = def
        .info()
        .slots
        .iter()
        .enumerate()
        .map(|(index, slot)| (index, slot.name, slot.ty))
        .collect();
    members.sort_by(|left, right| left.1.as_bytes().cmp(right.1.as_bytes()));
    for (index, name, ty) in &members {
        match ty {
            SlotType::Kind => {
                let _ = write!(out, " {name}={}", data.kind(*index).string());
            }
            SlotType::TokenFlags => {
                let _ = write!(out, " {name}={:#x}", data.token_flags(*index).bits());
            }
            SlotType::Text => {
                let _ = write!(out, " {name}=");
                quote_to_ascii(data.text(*index), out);
            }
            SlotType::Bool if data.bool(*index) => {
                let _ = write!(out, " {name}");
            }
            _ => {}
        }
    }
    out.push('\n');
    for (index, name, ty) in &members {
        match ty {
            SlotType::Node if !data.node(*index).is_nil() => {
                let label = format!(".{name}:");
                dump_node(a, out, &label, data.node(*index), node, indent + 2);
            }
            SlotType::NodeList if !data.list(*index).is_nil() => {
                dump_list(a, out, name, data.list(*index), node, indent + 2);
            }
            SlotType::ModifierList if !data.list(*index).is_nil() => {
                let flags = a.modifier_list_flags(data.modifiers(*index));
                let _ = writeln!(
                    out,
                    "{:indent$}.{name}.flags={:#x}",
                    "",
                    flags.bits(),
                    indent = indent + 2
                );
                dump_list(a, out, name, data.list(*index), node, indent + 2);
            }
            _ => {}
        }
    }
}

// The file as `expected_of` reads a golden text: what makes the file a module, then the tree.
fn dump(file: &File, ids: &IdAllocator) -> String {
    let arena = Arena::new();
    let open = Open::new(&arena, ids);
    let Ok(frozen) = Frozen::of_files(&[file]) else {
        return String::from("the file has no page table\n");
    };
    let a = Ast::new(&frozen, &open);
    let mut out = String::from("externalModuleIndicator ");
    let indicator = file.source_file.external_module_indicator;
    if indicator.is_nil() {
        out.push_str("<nil>\n");
    } else {
        let _ = writeln!(
            out,
            "{}[{},{})",
            a.kind(indicator).string(),
            a.pos(indicator),
            a.end(indicator)
        );
    }
    dump_node(a, &mut out, "root", file.source_file.root, NodeId::NIL, 0);
    out
}

// Of a golden text: the line of the module indicator, and the tree from the line of the root node on. The counts of the header are left out: the reference counts the nodes of its rewound lookaheads too.
fn expected_of(golden: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut in_tree = false;
    for line in golden.split_inclusive(|byte| *byte == b'\n') {
        if line.starts_with(b"root ") {
            in_tree = true;
        }
        if in_tree || line.starts_with(b"externalModuleIndicator ") {
            out.extend_from_slice(line);
        }
    }
    out
}

macro_rules! case {
    ($name:literal) => {
        (
            $name,
            include_bytes!(concat!("testdata/", $name, ".txt")),
            include_bytes!(concat!("testdata/", $name, ".tsgo.txt")),
        )
    };
}

// The inputs of the research probe that Bun's JavaScript parse accepts and that have no JSX and no JSDoc type. `p11.ts` is without its line `a < b > (c);`, which is a line of `ta2.js`: `ta1.ts` has the `<` and `<<` operators that are operators in a TypeScript file too, `ta2.js` the ones that are operators in a JavaScript file only. `dir1.ts` has the strings in parentheses that Bun keeps as directives or drops.
const CASES: &[(&str, &[u8], &[u8])] = &[
    case!("expr1.ts"),
    case!("stmt1.ts"),
    case!("mod1.ts"),
    case!("mod2.ts"),
    case!("mod3.ts"),
    case!("mod4.ts"),
    case!("p1.ts"),
    case!("p3.ts"),
    case!("p4.ts"),
    case!("p5.ts"),
    case!("p6.ts"),
    case!("p7.ts"),
    case!("p9.ts"),
    case!("p11.ts"),
    case!("q1.ts"),
    case!("q2.ts"),
    case!("q3.ts"),
    case!("q4.ts"),
    case!("q5.js"),
    case!("q6.ts"),
    case!("q7.ts"),
    case!("q8.ts"),
    case!("ta1.ts"),
    case!("ta2.js"),
    case!("dir1.ts"),
];

#[test]
#[cfg_attr(miri, ignore)]
fn lowered_tables_equal_the_trees_of_typescript_go() {
    let ids = IdAllocator::new();
    let mut failures: Vec<String> = Vec::new();
    for (name, contents, golden) in CASES {
        let (file, parse_diagnostics) = match lower(name, contents, &ids) {
            Ok(lowered) => lowered,
            Err(failure) => {
                failures.push(format!("{name}: {failure:?}"));
                continue;
            }
        };
        if file.fault_count() != 0 {
            failures.push(format!("{name}: the builder recorded a fault"));
        }
        // typescript-go reports no parse diagnostic for any of these inputs.
        if !parse_diagnostics.is_empty() {
            failures.push(format!("{name}: the lowering reported a parse diagnostic"));
        }
        let actual = dump(&file, &ids);
        let expected = expected_of(golden);
        if actual.as_bytes() == expected.as_slice() {
            continue;
        }
        let first = actual
            .as_bytes()
            .split(|byte| *byte == b'\n')
            .zip(expected.split(|byte| *byte == b'\n'))
            .position(|(left, right)| left != right)
            .unwrap_or(0);
        let line = |text: &[u8]| {
            let line = text.split(|byte| *byte == b'\n').nth(first).unwrap_or(&[]);
            quoted(line)
        };
        failures.push(format!(
            "{name}: line {first} is\n  {}\nand typescript-go has\n  {}",
            line(actual.as_bytes()),
            line(&expected)
        ));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// The kind of the error that ends the lowering of `contents`, when one does and no id was given.
fn refusal(name: &str, contents: &[u8]) -> Option<LowerErrorKind> {
    let ids = IdAllocator::new();
    let kind = match lower(name, contents, &ids) {
        Err(Failure::Lower(error)) => Some(error.kind),
        _ => None,
    };
    kind.filter(|_| ids.used() == crate::ast::PAGE_SIZE)
}

#[test]
#[cfg_attr(miri, ignore)]
fn what_has_no_node_yet_ends_the_lowering_without_a_table() {
    assert_eq!(
        refusal("el.jsx", b"const el = <div a=\"1\">text</div>;\n"),
        Some(LowerErrorKind::Unsupported)
    );
}

// Every statement of `ta2.js`. In a TypeScript file typescript-go reads type arguments in each but the last, where only its type grammar tells that it reads none.
const TYPE_ARGUMENTS_IN_A_TYPESCRIPT_FILE: &[&[u8]] = &[
    b"a < b > (c);",
    b"a < b, c > (d);",
    b"a < b.c > `x`;",
    b"a < 1 > (c);",
    b"new a < b > (c);",
    b"a < b >\nc;",
    b"x << y > (z) > (w);",
    b"x << 2 > (y);",
    b"a < b[c] > (d);",
    b"a < b | c > (d);",
    b"a < typeof b > (c);",
    b"a < -1 > (b);",
    b"a < b.\nc > (d);",
    b"g < h << i + j > (k);",
];

#[test]
#[cfg_attr(miri, ignore)]
fn type_arguments_of_a_typescript_file_end_the_lowering_without_a_table() {
    let mut failures: Vec<String> = Vec::new();
    for contents in TYPE_ARGUMENTS_IN_A_TYPESCRIPT_FILE {
        let text = quoted(contents);
        if refusal("x.ts", contents) != Some(LowerErrorKind::Unsupported) {
            failures.push(format!("{text}: a TypeScript file has a table"));
        }
        // A JavaScript file has the operators that Bun's parse has: `ta2.js` compares them.
        if lower("x.js", contents, &IdAllocator::new()).is_err() {
            failures.push(format!("{text}: a JavaScript file has no table"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// What Bun's parse without a visit takes and typescript-go reads another way, with a parse error: an assignment, a member or a second postfix operator after an expression that is no left-hand side expression, a prefix `++` before a unary expression, an optional chain in the callee of `new`, a `yield*` without an operand.
const READ_ANOTHER_WAY_BY_TYPESCRIPT_GO: &[&[u8]] = &[
    b"a + b = c;",
    b"-a = b;",
    b"a++ = b;",
    b"{ await using [a] = null; }",
    b"a++ ++;",
    b"a--.toString();",
    b"++ delete foo.bar;",
    b"new A?.b();",
    b"function* g() { yield*; }",
];

// Assignments to a left-hand side expression that is no target: typescript-go reads them, and its checker reports the target.
const ASSIGNMENTS_TO_A_LEFT_HAND_SIDE_EXPRESSION: &[&[u8]] = &[b"1 = 2;", b"f() = 1;"];

#[test]
#[cfg_attr(miri, ignore)]
fn what_typescript_go_reads_another_way_ends_the_lowering_without_a_table() {
    let mut failures: Vec<String> = Vec::new();
    for contents in READ_ANOTHER_WAY_BY_TYPESCRIPT_GO {
        if refusal("x.js", contents) != Some(LowerErrorKind::OutOfStep) {
            failures.push(format!("{}: the file has a table", quoted(contents)));
        }
    }
    for contents in ASSIGNMENTS_TO_A_LEFT_HAND_SIDE_EXPRESSION {
        if lower("x.js", contents, &IdAllocator::new()).is_err() {
            failures.push(format!("{}: the file has no table", quoted(contents)));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// What typescript-go reports for an input that Bun's parse accepts: the message, its range, its first argument.
type Reported = (MessageId, i32, i32, &'static [u8]);

const PARSE_DIAGNOSTICS: &[(&str, &[u8], &[Reported])] = &[
    (
        "a.js",
        b"x = 010;\n",
        &[(
            diagnostics::OCTAL_LITERALS_ARE_NOT_ALLOWED_USE_THE_SYNTAX_0,
            4,
            7,
            b"0o10",
        )],
    ),
    (
        "a.ts",
        b"label: for (;;) { break label; }\nx = 010; y = 09;\n",
        &[
            (
                diagnostics::OCTAL_LITERALS_ARE_NOT_ALLOWED_USE_THE_SYNTAX_0,
                37,
                40,
                b"0o10",
            ),
            (
                diagnostics::DECIMALS_WITH_LEADING_ZEROS_ARE_NOT_ALLOWED,
                46,
                48,
                b"",
            ),
        ],
    ),
    (
        "a.ts",
        b"import a from \"b\" assert { type: \"json\" };\n",
        &[(
            diagnostics::IMPORT_ASSERTIONS_HAVE_BEEN_REPLACED_BY_IMPORT_ATTRIBUTES_USE_WITH_INSTEAD_OF_ASSERT,
            18,
            24,
            b"",
        )],
    ),
    (
        "a.ts",
        b"class C { #x; m(a) { return a?.#x; } }\n",
        &[(
            diagnostics::AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
            31,
            33,
            b"",
        )],
    ),
    ("a.ts", b"a.\nb in c;\n", &[(diagnostics::IDENTIFIER_EXPECTED, 2, 2, b"")]),
];

#[test]
#[cfg_attr(miri, ignore)]
fn parse_diagnostics_of_typescript_go_are_carried() {
    let mut failures: Vec<String> = Vec::new();
    for (name, contents, expected) in PARSE_DIAGNOSTICS {
        let text = quoted(contents);
        let reported = match lower(name, contents, &IdAllocator::new()) {
            Ok((_, reported)) => reported,
            Err(failure) => {
                failures.push(format!("{text}: {failure:?}"));
                continue;
            }
        };
        let actual: Vec<Reported> = reported
            .iter()
            .map(|diagnostic| {
                let argument = diagnostic.args.first().map_or(&b""[..], Vec::as_slice);
                let argument = expected
                    .iter()
                    .map(|entry| entry.3)
                    .find(|entry| *entry == argument)
                    .unwrap_or(b"another argument");
                (
                    diagnostic.message,
                    diagnostic.loc.pos(),
                    diagnostic.loc.end(),
                    argument,
                )
            })
            .collect();
        if actual.as_slice() != *expected {
            failures.push(format!(
                "{text}: the lowering reported {actual:?}, typescript-go reports {expected:?}"
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
