#!/usr/bin/env python3
"""Applies the test side of the prototype to a COPY of src/js_parser: the tests that name the old payloads, and the new ones.

usage: apply_tests.py <copy of src/js_parser> [rows.rs] [rejection-rows.rs]
rows.rs: the table that `payload-oracle.cjs --rust inputs.json` prints; rejection-rows.rs: a row for each source of inputs-rejections.json
"""
import sys
from pathlib import Path

root = Path(sys.argv[1])
rows = Path(sys.argv[2]).read_text() if len(sys.argv) > 2 else ""
rejections = Path(sys.argv[3]).read_text() if len(sys.argv) > 3 else ""
rejection_count = rejections.count("\n")


def edit(rel, old, new, count=1):
    path = root / rel
    text = path.read_text()
    found = text.count(old)
    if found != count:
        sys.exit(f"{rel}: expected {count} of {old[:70]!r}, found {found}")
    path.write_text(text.replace(old, new))


# ───────────── type_sink_tests.rs: the outline of a type is shared with the tests of the payloads ─────────────
edit("type_sink_tests.rs", "fn outline(node: ts::Type, lines: &mut Vec<String>) {",
     "pub(crate) fn outline(node: ts::Type, lines: &mut Vec<String>) {")

# ───────────── parse/erased_tests.rs ─────────────
T = "parse/erased_tests.rs"
edit(T, """use bun_ast::{ExprData, G, LocRef, StmtData};
""", """use bun_ast::ts::{self, MemberData};
use bun_ast::{ExprData, G, LocRef, StmtData, StoreSlice};

use crate::type_sink_tests::outline;
""")
edit(T, """        ErasedData::Interface(name) => ("interface", named(name)),
        ErasedData::TypeAlias(name) => ("type-alias", named(name)),
""", """        ErasedData::Interface(interface) => ("interface", named(interface.name)),
        ErasedData::TypeAlias(alias) => ("type-alias", named(alias.name)),
""")
edit(T, """#[test]
fn records_are_those_of_the_known_sources() {""", """/// A line for each interface, type alias and index signature of a class that a lint parse recorded, by where they start: the kind and the range of every node.
pub(crate) fn payloads(parsed: &ParsedForLint<'_, '_>) -> Vec<String> {
    let sidecar = parsed.sidecar;
    let mut lines: Vec<(u32, String)> = Vec::new();
    for record in &sidecar.erased.statements {
        let (start, end) = (record.start, record.end);
        let mut words = Vec::new();
        match record.data {
            ErasedData::TypeAlias(alias) => {
                words.push(format!("TypeAliasDeclaration[{start},{end})"));
                declaration_head(parsed, &alias.name, &mut words);
                outline(alias.type_node, &mut words);
            }
            ErasedData::Interface(interface) => {
                words.push(format!("InterfaceDeclaration[{start},{end})"));
                declaration_head(parsed, &interface.name, &mut words);
                for clause in interface.heritage_clauses.slice() {
                    let token = match clause.token {
                        ts::HeritageToken::Extends => "extends",
                        ts::HeritageToken::Implements => "implements",
                    };
                    words.push(format!("{token}[{},{})", clause.start, clause.end));
                    for &entry in clause.types.iter() {
                        outline(entry, &mut words);
                    }
                }
                let members = interface.members;
                words.push(format!("members[{},{})", members.start, members.end));
                for member in members.iter() {
                    member_outline(member, &mut words);
                }
            }
            _ => continue,
        }
        lines.push((start, words.join(" ")));
    }
    for member in &sidecar.erased.members {
        let ErasedMemberData::IndexSignature(signature) = member.data else {
            continue;
        };
        let mut words = vec![format!("IndexSignature[{},{})", member.start, member.end)];
        let parameters = Some(signature.parameters);
        signature_outline(
            signature.modifiers,
            None,
            None,
            parameters,
            signature.type_node,
            &mut words,
        );
        lines.push((member.start, words.join(" ")));
    }
    lines.sort_by_key(|line| line.0);
    lines.into_iter().map(|line| line.1).collect()
}

/// The name of an interface or of a type alias, and its type parameters from `<` to after `>`.
fn declaration_head(parsed: &ParsedForLint<'_, '_>, name: &Name, words: &mut Vec<String>) {
    words.push(format!("name[{},{})", name.start, name.end));
    if let Some(list) = parsed.sidecar.generics.type_parameters_of(name) {
        words.push(format!("typeParameters[{},{})", list.lt, list.end));
    }
}

fn member_outline(member: &ts::Member, words: &mut Vec<String>) {
    let kind = member.data.kind_name();
    words.push(format!("{kind}[{},{})", member.start, member.end));
    let none = StoreSlice::EMPTY;
    match member.data {
        MemberData::PropertySignature(property) => {
            let (name, question) = (Some(property.name), property.postfix_token);
            signature_part(property.modifiers, name, question, words);
            signature_outline(none, None, None, None, property.type_node, words);
        }
        MemberData::MethodSignature(method) => {
            let (name, question) = (Some(method.name), method.postfix_token);
            signature_part(method.modifiers, name, question, words);
            let parameters = Some(method.parameters);
            let type_parameters = method.type_parameters;
            signature_outline(none, type_parameters, None, parameters, method.type_node, words);
        }
        MemberData::CallSignature(call) => {
            let parameters = Some(call.parameters);
            signature_outline(none, call.type_parameters, None, parameters, call.type_node, words);
        }
        MemberData::ConstructSignature(construct) => {
            let parameters = Some(construct.parameters);
            let type_parameters = construct.type_parameters;
            signature_outline(none, type_parameters, None, parameters, construct.type_node, words);
        }
        MemberData::IndexSignature(index) => {
            let parameters = Some(index.parameters);
            signature_outline(index.modifiers, None, None, parameters, index.type_node, words);
        }
        MemberData::GetAccessor(accessor) => {
            signature_part(accessor.modifiers, Some(accessor.name), None, words);
            let parameters = Some(accessor.parameters);
            let type_parameters = accessor.type_parameters;
            signature_outline(none, type_parameters, None, parameters, accessor.type_node, words);
        }
        MemberData::SetAccessor(accessor) => {
            signature_part(accessor.modifiers, Some(accessor.name), None, words);
            let parameters = Some(accessor.parameters);
            let type_parameters = accessor.type_parameters;
            signature_outline(none, type_parameters, None, parameters, accessor.type_node, words);
        }
    }
}

/// The modifiers, the name and the `?` of a member.
fn signature_part(
    modifiers: StoreSlice<ts::Modifier>,
    name: Option<ts::PropertyName>,
    question: Option<ts::Token>,
    words: &mut Vec<String>,
) {
    for modifier in modifiers.slice() {
        let word = match modifier.data {
            ts::ModifierData::Keyword(kind) => format!("{kind:?}"),
            ts::ModifierData::Decorator(_) => "Decorator".to_owned(),
        };
        words.push(format!("{word}[{},{})", modifier.start, modifier.end));
    }
    if let Some(name) = name {
        words.push(format!("name[{},{})", name.start(), name.end()));
    }
    if let Some(token) = question {
        words.push(format!("?[{},{})", token.start, token.end));
    }
}

/// The modifiers, the type parameters, the parameters and the type of a signature.
fn signature_outline(
    modifiers: StoreSlice<ts::Modifier>,
    type_parameters: Option<ts::List<ts::TypeParameter>>,
    question: Option<ts::Token>,
    parameters: Option<ts::List<ts::Parameter>>,
    type_node: Option<ts::Type>,
    words: &mut Vec<String>,
) {
    signature_part(modifiers, None, question, words);
    if let Some(list) = type_parameters {
        words.push(format!("typeParameters[{},{})", list.start, list.end));
        for parameter in list.iter() {
            words.push(format!("TypeParameter[{},{})", parameter.start, parameter.end));
            for node in [parameter.constraint, parameter.default_type].into_iter().flatten() {
                outline(node, words);
            }
        }
    }
    if let Some(list) = parameters {
        words.push(format!("parameters[{},{})", list.start, list.end));
        for parameter in list.iter() {
            words.push(format!("Parameter[{},{})", parameter.start, parameter.end));
            if let Some(node) = parameter.type_node {
                outline(node, words);
            }
        }
    }
    if let Some(node) = type_node {
        outline(node, words);
    }
}

struct Payloads {
    name: &'static str,
    text: &'static [u8],
    /// One line for each interface, type alias and index signature of a class, by where they start.
    lines: &'static [&'static str],
}

/// The lines of `payloads` for the lint parse of `text`. `None`: it does not parse.
fn lint_payloads(text: &'static [u8]) -> Option<Vec<String>> {
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(&b"/a.ts"[..], text);
    let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    parser.parse_for_lint(payloads).ok()
}

#[test]
fn payloads_are_the_nodes_that_tsc_builds() {
    let mut failed = Vec::new();
    for case in PAYLOADS {
        let lines = case.lines.iter().map(|line| (*line).to_owned()).collect();
        let expected: Option<Vec<String>> = Some(lines);
        let found = lint_payloads(case.text);
        if found != expected {
            failed.push(format!("{}: {found:#?}", case.name));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

/// Every line is what tsc 6.0.2 builds for the text, with the kinds of typescript-go for the entries of a heritage clause.
const PAYLOADS: &[Payloads] = &[
ROWS];

#[test]
fn records_are_those_of_the_known_sources() {""".replace("ROWS", rows))

# ───────────── parse/erased.rs: the unit tests that build records by hand ─────────────
E = "parse/erased.rs"
edit(E, """    fn placeholder(start: i32) -> Stmt {""", """    fn interface(text: &'static [u8], start: u32) -> ErasedData {
        let declaration = Box::leak(Box::new(InterfaceDeclaration {
            name: name(text, start),
            heritage_clauses: StoreSlice::EMPTY,
            members: ts::List::empty(start, start),
        }));
        ErasedData::Interface(StoreRef::from_bump(declaration))
    }

    fn alias(text: &'static [u8], start: u32) -> ErasedData {
        let declaration = Box::leak(Box::new(TypeAliasDeclaration {
            name: name(text, start),
            type_node: ts::Type::keyword(ts::KeywordKind::Any, start, start),
        }));
        ErasedData::TypeAlias(StoreRef::from_bump(declaration))
    }

    fn index_signature(open_bracket: u32) -> ts::IndexSignature {
        ts::IndexSignature {
            modifiers: StoreSlice::EMPTY,
            parameters: ts::List::empty(open_bracket + 1, open_bracket + 1),
            type_node: None,
        }
    }

    fn placeholder(start: i32) -> Stmt {""")
edit(E, """        let interface = ErasedData::Interface(name(b"A", 17));
        let empty = ErasedFlags::empty();
        tables.statement(
            cursor(source, &[], 22),
            Loc { start: 7 },
            empty,
            Exported::Before,
            interface,
        );
        tables.dropped(Loc { start: 7 }, 0, scopes);
        let interface = ErasedData::Interface(name(b"E", 43));
        tables.statement(
            cursor(source, &[], 47),
            Loc { start: 33 },
            empty,
            Exported::Before,
            interface,
        );""", """        let empty = ErasedFlags::empty();
        tables.statement(
            cursor(source, &[], 22),
            Loc { start: 7 },
            empty,
            Exported::Before,
            interface(b"A", 17),
        );
        tables.dropped(Loc { start: 7 }, 0, scopes);
        tables.statement(
            cursor(source, &[], 47),
            Loc { start: 33 },
            empty,
            Exported::Before,
            interface(b"E", 43),
        );""")
edit(E, """        let alias = ErasedData::TypeAlias(name(b"A", 27));
        let ambient = ErasedFlags::AMBIENT;""", """        let alias = alias(b"A", 27);
        let ambient = ErasedFlags::AMBIENT;""")
edit(E, """        let alias = ErasedData::TypeAlias(name(b"A", 5));
        tables.statement(
            cursor(source, &[], 12),
            Loc { start: 0 },
            empty,
            Exported::No,
            alias,
        );
        let mark = tables.mark();
        tables.statement(
            cursor(source, &[], 23),
            Loc { start: 12 },
            empty,
            Exported::No,
            alias,
        );
        tables.member_modifier(ErasedFlags::DECLARE);
        tables.hold(alias);""", """        let alias = alias(b"A", 5);
        tables.statement(
            cursor(source, &[], 12),
            Loc { start: 0 },
            empty,
            Exported::No,
            alias,
        );
        let mark = tables.mark();
        tables.statement(
            cursor(source, &[], 23),
            Loc { start: 12 },
            empty,
            Exported::No,
            alias,
        );
        let arena = Arena::new();
        tables.member_index_signature(&arena, index_signature(0));
        tables.member_modifier(ErasedFlags::DECLARE);
        tables.hold(alias);""")
edit(E, """    #[test]
    fn member_without_a_record_is_an_index_signature() {
        let source = b"class C { declare static [k: string]: any; [n: number]: 1; x = 1 }";
        let mut tables = ErasedTables::default();
        tables.member_modifier(ErasedFlags::DECLARE);
        tables.member_read(
            cursor(source, &[], 43),
            Loc { start: 10 },
            Loc { start: 8 },
            0,
            true,
        );
        tables.member_read(
            cursor(source, &[], 59),
            Loc { start: 43 },
            Loc { start: 8 },
            0,
            false,
        );
        let [first, second] = tables.members.as_slice() else {
            panic!("two records");
        };
        assert!(matches!(first.data, ErasedMemberData::IndexSignature));
        assert_eq!((first.start, first.end), (10, 42));
        assert_eq!((first.class_body, first.index), (8, 0));
        assert_eq!(first.flags, ErasedFlags::STATIC | ErasedFlags::DECLARE);
        assert!(matches!(second.data, ErasedMemberData::IndexSignature));
        assert_eq!(
            (second.start, second.end, second.flags),
            (43, 58, ErasedFlags::empty())
        );
    }""", """    /// The modifiers that `member_read` found for the index signature of `member`, as kind, start and end.
    fn modifiers_of(member: &ErasedMember) -> Vec<(ts::ModifierKind, u32, u32)> {
        let ErasedMemberData::IndexSignature(signature) = member.data else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for modifier in signature.modifiers.slice() {
            if let ts::ModifierData::Keyword(kind) = modifier.data {
                found.push((kind, modifier.start, modifier.end));
            }
        }
        found
    }

    #[test]
    fn an_index_signature_is_placed_with_the_modifiers_before_it() {
        let source = b"class C { declare static [k: string]: any; [n: number]: 1; x = 1 }";
        let arena = Arena::new();
        let mut tables = ErasedTables::default();
        tables.member_index_signature(&arena, index_signature(25));
        tables.member_modifier(ErasedFlags::DECLARE);
        tables.member_read(
            cursor(source, &[], 43),
            &arena,
            Loc { start: 10 },
            Loc { start: 8 },
            0,
            true,
            &[],
        );
        tables.member_index_signature(&arena, index_signature(43));
        tables.member_read(
            cursor(source, &[], 59),
            &arena,
            Loc { start: 43 },
            Loc { start: 8 },
            0,
            false,
            &[],
        );
        // No member waits for its place: nothing is recorded.
        tables.member_read(
            cursor(source, &[], 65),
            &arena,
            Loc { start: 59 },
            Loc { start: 8 },
            0,
            false,
            &[],
        );
        tables.member_modifier(ErasedFlags::ABSTRACT);
        let [first, second] = tables.members.as_slice() else {
            panic!("two records");
        };
        assert_eq!((first.start, first.end), (10, 42));
        assert_eq!((first.class_body, first.index), (8, 0));
        assert_eq!(first.flags, ErasedFlags::STATIC | ErasedFlags::DECLARE);
        assert_eq!(
            modifiers_of(first),
            [
                (ts::ModifierKind::Declare, 10, 17),
                (ts::ModifierKind::Static, 18, 24)
            ]
        );
        assert_eq!(
            (second.start, second.end, second.flags),
            (43, 58, ErasedFlags::empty())
        );
        assert_eq!(modifiers_of(second), []);
    }

    #[test]
    fn modifiers_are_the_words_between_the_decorators_and_the_bracket() {
        let found = |source: &[u8], floor: u32, at: u32| -> Vec<(ts::ModifierKind, u32, u32)> {
            modifiers_before(source, &[], floor, at)
                .iter()
                .filter_map(|modifier| match modifier.data {
                    ts::ModifierData::Keyword(kind) => Some((kind, modifier.start, modifier.end)),
                    ts::ModifierData::Decorator(_) => None,
                })
                .collect()
        };
        let (readonly, r#static) = (ts::ModifierKind::Readonly, ts::ModifierKind::Static);
        assert_eq!(
            found(b"@d.static readonly\\n static [k: string]: any", 0, 27),
            [(readonly, 10, 18), (r#static, 20, 26)]
        );
        assert_eq!(found(b"@readonly [k: string]: any", 0, 10), []);
        assert_eq!(found(b"@(d) static [k: string]: any", 0, 12), [(r#static, 5, 11)]);
        // The word before the member is the name of the member before it.
        assert_eq!(found(b"declare\\n[k: string]: any", 8, 8), []);
        assert_eq!(found(b"get [k: string]: any", 0, 4), []);
    }""")

# ───────────── parse/parse_skip_typescript.rs: one record in every list ─────────────
K = "parse/parse_skip_typescript.rs"
edit(K, """    use crate::parse::erased::{Cursor, ErasedData, ErasedFlags, Exported, Name};
""", """    use crate::parse::erased::{
        Cursor, ErasedData, ErasedFlags, Exported, InterfaceDeclaration, Name,
    };
""")
edit(K, """        let interface = ErasedData::Interface(Name::at(&p.lexer));
""", """        let interface = ErasedData::Interface(bun_ast::StoreRef::from_bump(p.arena.alloc(
            InterfaceDeclaration {
                name: Name::at(&p.lexer),
                heritage_clauses: bun_ast::StoreSlice::EMPTY,
                members: ts::List::empty(start, end),
            },
        )));
        let index_signature = ts::IndexSignature {
            modifiers: bun_ast::StoreSlice::EMPTY,
            parameters: ts::List::empty(start, end),
            type_node: None,
        };
""")
edit(K, """            starts.erased.member_read(cursor, at, at, 0, false);
""", """            starts
                .erased
                .member_index_signature(p.arena, index_signature);
            starts
                .erased
                .member_read(cursor, p.arena, at, at, 0, false, &[]);
""")

# ───────────── parse/erased_tests.rs: what a lint parse rejects in these statements, and how often it records one ─────────────
edit(T, """use super::parse_entry::{Options, ParsedForLint, Parser};
""", """use super::parse_entry::{Options, ParsedForLint, Parser};
use super::syntax_errors::SyntaxErrors;
""")
edit(T, """#[test]
fn records_are_those_of_the_known_sources() {""", """/// The entry of the first error that the lint parse of `text` logs, as code, start, end and text. `None`: it parses.
fn first_error(text: &'static [u8]) -> Option<(u32, u32, u32, Vec<u8>)> {
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(&b"/a.ts"[..], text);
    let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let mut errors = SyntaxErrors::default();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    if parser
        .parse_for_lint_with_codes(&mut errors, |_| ())
        .is_ok()
    {
        return None;
    }
    let first = log
        .msgs
        .iter()
        .position(|msg| msg.kind == bun_ast::Kind::Err)?;
    let Some(entry) = errors.get(first) else {
        return Some((0, 0, 0, Vec::new()));
    };
    Some((entry.code, entry.start, entry.end, entry.text.to_vec()))
}

#[test]
fn an_erased_statement_is_read_as_the_reference_reads_it() {
    // The code, the range and the text are the first diagnostic of tsc 6.0.2 and of typescript-go for each text.
    let cases: [(&'static [u8], u32, u32, u32, &str); REJECTION_COUNT] = [
REJECTIONS    ];
    let mut failed = Vec::new();
    for (text, code, start, end, message) in cases {
        let found = first_error(text);
        if found != Some((code, start, end, message.as_bytes().to_vec())) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

#[test]
fn a_declaration_named_like_a_cast_is_recorded_once() {
    let text: &'static [u8] = b"type as<T> = T;\\ninterface satisfies<U> extends B<U> { a: U }\\n";
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(&b"/a.ts"[..], text);
    let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let counts = Parser::init(options, &mut log, &source, &define, &arena)
        .ok()
        .and_then(|parser| {
            parser
                .parse_for_lint(|parsed| {
                    let sidecar = parsed.sidecar;
                    (
                        sidecar.erased.statements.len(),
                        sidecar.generics.type_parameters.len(),
                    )
                })
                .ok()
        });
    assert_eq!(counts, Some((2, 2)));
}

#[test]
fn records_are_those_of_the_known_sources() {""".replace("REJECTION_COUNT", str(rejection_count)).replace("REJECTIONS", rejections))
print("applied tests")
