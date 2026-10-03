// Writes the Rust file that holds the 366 cases of the four test files test/bundler/transpiler/typescript-grammar*.test.ts:
// src/js_parser/parse/grammar_rows_tests.rs. Every expectation is read from tsc 6.0.2 (rows.facts2.json, made by gen/facts2.mjs of
// ../bottom-up from rows.facts.json of tests-known-differences/bottom-up). Run rustfmt --edition 2024 on the output, outside the
// worktree: the tables are under #[rustfmt::skip], one row on a line.
// usage: node rust5.mjs [--rows=<rows.facts2.json>] [--out=<file>] [--as-without-lint=<case,case,...>] [--keeps=<case>:<tag+tag>,...]
// ROWS has the 366 cases in the order of the four files, a comment before each of the 37 groups, and what tsc makes of each source.
// The cases named are those a lint parse does not read as tsc does. Their sources go into the table KNOWN_DIFFERENCES with what the
// lint parse makes of them, a fifth test reads that table, and the test of ROWS passes them by: the expectation of tsc stays in ROWS.
//   --as-without-lint=<cases>   the lint parse does what a parse without lint does (the field `main` of the rows): the text and
//                               the offset of its first message, or the tag of each statement it keeps
//   --keeps=<case>:<tag+tag>    the lint parse takes the source and keeps statements with these tags (<case>: for none)
// A case is its index 0..365. Every case with the same loader and source follows the one named.
// Without these arguments the file has four tests and no such table.
import { readFileSync, writeFileSync } from "node:fs";
import { ts } from "/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/gen/roots.mjs";
import { familyOf } from "/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/gen/families.mjs";
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) ?? `--${name}=`).slice(name.length + 3);
const ROWS = arg("rows") || "/workspace/notes/lint/units/parser/round3/lint-grammar-tests-r4/bottom-up/rows.facts2.json";
const rows = JSON.parse(readFileSync(ROWS, "utf8"));
const asWithoutLint = new Set(arg("as-without-lint").split(",").filter(Boolean).map(Number));
const keeps = new Map(arg("keeps").split(",").filter(Boolean).map(item => { const [i, tags] = item.split(":"); return [Number(i), (tags ?? "").split("+").filter(Boolean)]; }));
for (const i of [...asWithoutLint, ...keeps.keys()]) if (!rows[i]) throw new Error("no case " + i);
for (const a of process.argv.slice(2)) if (!/^--(rows|out|as-without-lint|keeps)=/.test(a)) throw new Error("no argument " + a);

const bytes = text => 'b"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const str = text => '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const list = items => (items.length === 0 ? "&[]" : "&[" + items.map(str).join(", ") + "]");
const DIALECT = { ts: "Ts", tsx: "Tsx", js: "Js", deco: "Decorators" };

// The type roots of the rows of the classes T and M: the text from the root to the end of the source, its outline, and where the next token starts.
const typeTables = { type: new Map(), return: new Map(), "type-parameters": new Map() };
for (const r of rows) {
  if (r.reject || (r.class !== "T" && r.class !== "M")) continue;
  const loader = r.loader === "deco" ? "ts" : r.loader;
  const add = (entry, start, end, outline) => {
    const rest = r.src.slice(start);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, r.src);
    scanner.setTextPos(end);
    const next = (scanner.scan() === ts.SyntaxKind.EndOfFileToken ? r.src.length : scanner.getTokenStart()) - start;
    if (!typeTables[entry].has(rest)) typeTables[entry].set(rest, { outline, next, rows: [] });
    const e = typeTables[entry].get(rest);
    if (e.outline !== outline || e.next !== next) throw new Error("two readings of " + rest);
    e.rows.push(r.i);
  };
  for (const root of r.roots) {
    if (root.entry === "type" || root.entry === "return") add(root.entry, root.start, root.end, root.outline);
    else if (root.entry === "type-parameters") {
      const t = typeTables["type-parameters"];
      if (!t.has(root.text)) t.set(root.text, { outline: root.outline, closeEnd: root.closeEnd, rows: [] });
      t.get(root.text).rows.push(r.i);
    }
  }
}
// A heritage entry is read with its class or interface: its type arguments are read alone.
// (The roots of roots.mjs hold them inside the ExpressionWithTypeArguments; `(a = 1) => void` is in the table from other rows.)

// The tag of each statement of a program that a parse without lint printed.
const K = ts.SyntaxKind;
const STATEMENT = { [K.VariableStatement]: "s_local", [K.ExpressionStatement]: "s_expr", [K.FunctionDeclaration]: "s_function", [K.ClassDeclaration]: "s_class", [K.Block]: "s_block", [K.ImportDeclaration]: "s_import" };
const tagsOfOutput = text => ts.createSourceFile("/o.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).statements.map(st => STATEMENT[st.kind] ?? (() => { throw new Error("no tag for " + K[st.kind]); })());
// What a parse without lint makes of a row: the text and the offset of its first message, or the tag of each statement it keeps.
function asMain(r) {
  if (r.main[0] === "e") {
    const [text, line, column] = r.main[1][0];
    const offset = r.src.split("\n").slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
    return `Err((${bytes(text)}, ${offset}))`;
  }
  return `Ok(${list(r.class === "M" ? r.facts.kept : tagsOfOutput(r.main[1]))})`;
}
// The sources that a lint parse does not read as tsc does, each with what the lint parse makes of it.
const known = new Map();
for (const r of rows) {
  const key = r.loader + "\0" + r.src;
  if (keeps.has(r.i)) known.set(key, `Ok(${list(keeps.get(r.i))})`);
  else if (asWithoutLint.has(r.i)) known.set(key, asMain(r));
}
const entries = [];
let lastGroup = null;
for (const r of rows) {
  const family = familyOf(r);
  let want;
  if (r.reject) want = `Want::Fails(${r.reject.code}, ${r.reject.start}, ${r.reject.end})`;
  else {
    const f = r.facts;
    want = `Want::Reads(${str(`kept[${f.kept.join(" ")}] erased[${f.erased.join(" | ")}] wrappers[${f.wrappers.join(" | ")}] nodes[${f.nodes}] enums[${f.enums.join(" | ")}] types[${f.types.join(" | ")}] return_types[${f.returnTypes.join(" | ")}] type_parameters[${f.typeParameters.join(" | ")}] heritage[${f.heritage.join(" | ")}]`)})`;
  }
  const group = `${r.file}\0${r.describe}: ${r.group.replace(/: %s( %j)?$/, "").replace(/: %j passes design:%s$/, "")}`;
  entries.push({ i: r.i, group: group === lastGroup ? null : group, family, dialect: DIALECT[r.loader], text: r.src, want, key: r.loader + "\0" + r.src });
  lastGroup = group;
}
const seen = new Map();
for (const e of entries) if (!seen.has(e.key)) seen.set(e.key, e);

const out = [];
const emit = line => out.push(line);
emit(`//! TypeScript that a lint parse reads with its own grammar and at its own sites: each expectation is what tsc 6.0.2 makes of the source.

use bun_alloc::Arena;
use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, ExprTag, G, Loader, Loc, S, ts};

use super::erased_tests;
use super::parse_entry::{Options, ParsedForLint, Parser};
use super::syntax_errors::SyntaxErrors;
use super::wrappers::Wrapper;
use crate::defines::Define;
use crate::type_sink_tests::{outline, read_from, type_parameters_read, type_read};

/// How a source is read: its loader, and with \`Decorators\` the decorators of TypeScript and their metadata.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Dialect {
    Ts,
    Tsx,
    Js,
    Decorators,
}

enum Want {
    /// tsc parses the source and reads this outside its types: the line that \`facts\` makes.
    Reads(&'static str),
    /// tsc rejects the source: the code, the start and the end of its first diagnostic.
    Fails(u32, u32, u32),
}

struct Row {
    /// The change of the grammar that the source shows.
    family: &'static str,
    dialect: Dialect,
    text: &'static [u8],
    want: Want,
}

/// The first error of a lint parse that fails: the code, the start and the end of its entry, zeros where it has none, and the text and the offset of its message.
struct Failure {
    entry: (u32, u32, u32),
    text: String,
    offset: usize,
}

/// What a lint parse made of a source, for the message of a test that fails.
fn said(found: &Result<String, Failure>) -> String {
    match found {
        Ok(line) => line.clone(),
        Err(failure) => {
            let (code, start, end) = failure.entry;
            let (text, offset) = (&failure.text, failure.offset);
            format!("TS{code} [{start},{end}), the message at {offset}: {text}")
        }
    }
}

/// What \`check\` makes of the lint parse of \`text\`, or its first error.
fn lint_parse<R>(
    dialect: Dialect,
    text: &'static [u8],
    check: impl FnOnce(&ParsedForLint<'_, '_>) -> R,
) -> Result<R, Failure> {
    let (path, loader): (&'static [u8], Loader) = match dialect {
        Dialect::Ts | Dialect::Decorators => (b"/a.ts", Loader::Ts),
        Dialect::Tsx => (b"/a.tsx", Loader::Tsx),
        Dialect::Js => (b"/a.js", Loader::Js),
    };
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    options.features.standard_decorators = dialect != Dialect::Decorators;
    options.features.emit_decorator_metadata = dialect == Dialect::Decorators;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let mut errors = SyntaxErrors::default();
    let Ok(parser) = Parser::init(options, &mut log, &source, &define, &arena) else {
        return Err((0, 0, 0));
    };
    if let Ok(found) = parser.parse_for_lint_with_codes(&mut errors, check) {
        return Ok(found);
    }
    let first = log.msgs.iter().position(|msg| msg.kind == bun_ast::Kind::Err);
    let entry = first.and_then(|first| errors.get(first));
    Err(entry.map_or((0, 0, 0), |entry| (entry.code, entry.start, entry.end)))
}

/// The line of a wrapper record, as the tests of \`wrappers\` print it.
fn wrapper_line(record: &Wrapper) -> String {
    let kind = record.data.kind_name();
    let (op, end) = (record.op, record.end);
    let type_node = record.type_node().map(described).unwrap_or_default();
    let tag = <&'static str>::from(record.operand.data.tag());
    let start = record.operand.loc.start;
    format!("{kind} [{op},{end}){type_node} of {tag}@{start}")
}

fn described(type_node: ts::Type) -> String {
    let kind = type_node.data.kind_name();
    let name = match type_node.data {
        ts::TypeData::TypeReference(reference) => match reference.type_name {
            ts::EntityName::Identifier(name) => format!("({})", bstr::BStr::new(name.text.slice())),
            ts::EntityName::QualifiedName(_) => String::new(),
        },
        _ => String::new(),
    };
    format!(" {kind}{name}[{},{})", type_node.start, type_node.end)
}

/// The nodes of the statements that stay which the rows are about.
struct Nodes<'r, 'p, 'a> {
    parsed: &'r ParsedForLint<'p, 'a>,
    found: Vec<(i32, &'static str)>,
    enums: Vec<String>,
}

impl Nodes<'_, '_, '_> {
    fn accessors(&mut self, class: &G::Class) {
        for property in class.properties.slice() {
            if property.kind == G::PropertyKind::AutoAccessor {
                let start = property.key.map_or(-1, |key| key.loc.start);
                self.found.push((start, "auto_accessor"));
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Nodes<'_, '_, '_> {
    fn enter_expr(&mut self, expr: &'ast Expr) {
        let tag = expr.data.tag();
        if matches!(
            tag,
            ExprTag::EIf | ExprTag::EArrow | ExprTag::ECall | ExprTag::EImport | ExprTag::EImportMeta
        ) {
            self.found.push((expr.loc.start, tag.into()));
        }
    }

    fn visit_s_class(&mut self, node: &'ast S::Class, _loc: Loc) {
        self.accessors(&node.class);
        walk::walk_s_class(self, node);
    }

    fn visit_e_class(&mut self, node: &'ast E::Class, _loc: Loc) {
        self.accessors(node);
        walk::walk_e_class(self, node);
    }

    fn visit_s_enum(&mut self, node: &'ast S::Enum, _loc: Loc) {
        let name = bstr::BStr::new(self.parsed.name_of(node.name.ref_));
        let members: Vec<String> = node
            .values
            .slice()
            .iter()
            .map(|value| bstr::BStr::new(value.name.slice()).to_string())
            .collect();
        self.enums.push(format!("{name}={}", members.join(",")));
        walk::walk_s_enum(self, node);
    }
}

/// The tag of each statement that the file keeps.
fn kept(parsed: &ParsedForLint<'_, '_>) -> Vec<&'static str> {
    parsed.stmts.iter().map(|stmt| stmt.data.tag().into()).collect()
}

/// The outline of a type, as the tests of the sink print it.
fn outlined(node: ts::Type) -> String {
    let mut lines = Vec::new();
    outline(node, &mut lines);
    lines.join(" ")
}

/// The lines of a list in the order of the source.
fn in_order(mut list: Vec<(u32, String)>) -> String {
    list.sort();
    let lines: Vec<String> = list.into_iter().map(|(_, line)| line).collect();
    lines.join(" | ")
}

/// The types that the side table keeps for the nodes that stay: annotations, return types, type parameters and the heritage of classes.
fn records(parsed: &ParsedForLint<'_, '_>) -> String {
    let attached = &parsed.sidecar.attached;
    let types = attached
        .annotations
        .iter()
        .filter_map(|record| record.type_node)
        .map(|node| (node.start, outlined(node)))
        .collect();
    let return_types = attached
        .return_types
        .iter()
        .map(|record| (record.type_node.start, outlined(record.type_node)))
        .collect();
    let mut type_parameters = Vec::new();
    for record in &attached.type_parameters {
        let list = record.list;
        let mut line = format!("<{},{}>{{{},{}}}", record.lt, record.end, list.start, list.end);
        for parameter in list.iter() {
            let name = bstr::BStr::new(parameter.name.text.slice());
            line.push_str(&format!(" {name}[{},{})", parameter.start, parameter.end));
        }
        type_parameters.push((record.lt, line));
    }
    let mut heritage = Vec::new();
    for record in &attached.heritage {
        let token = match record.clause.token {
            ts::HeritageToken::Extends => "extends",
            ts::HeritageToken::Implements => "implements",
        };
        for &node in record.clause.types.iter() {
            heritage.push((node.start, format!("{token}: {}", outlined(node))));
        }
    }
    format!(
        "types[{}] return_types[{}] type_parameters[{}] heritage[{}]",
        in_order(types),
        in_order(return_types),
        in_order(type_parameters),
        in_order(heritage)
    )
}

/// What the lint parse shows of the source: the statements that stay, the dropped records, the wrappers, the conditionals, arrow functions, calls, \`import()\`, \`import.meta\` and auto-accessors by offset, the enums, and the recorded types.
fn facts(parsed: &ParsedForLint<'_, '_>) -> String {
    let mut nodes = Nodes {
        parsed,
        found: Vec::new(),
        enums: Vec::new(),
    };
    for stmt in parsed.stmts {
        nodes.visit_stmt(stmt);
    }
    nodes.found.sort();
    let found: Vec<String> = nodes
        .found
        .iter()
        .map(|(start, tag)| format!("{tag}@{start}"))
        .collect();
    let wrappers: Vec<String> = parsed.sidecar.wrappers.records.iter().map(wrapper_line).collect();
    format!(
        "kept[{}] erased[{}] wrappers[{}] nodes[{}] enums[{}] {}",
        kept(parsed).join(" "),
        erased_tests::describe(parsed).join(" | "),
        wrappers.join(" | "),
        found.join(" "),
        nodes.enums.join(" | "),
        records(parsed)
    )
}

#[test]
fn a_type_of_a_row_is_the_nodes_that_tsc_builds() {
    let mut failed = Vec::new();
    for &(text, expected, next) in TYPES {
        let found = type_read(text).map(|(outline, errors, _, start)| (outline, errors, start));
        if found != Some((expected.to_owned(), 0, next)) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

#[test]
fn a_return_type_of_a_row_is_the_nodes_that_tsc_builds() {
    let mut failed = Vec::new();
    for &(text, expected, next) in RETURN_TYPES {
        let found = read_from(text, |p| p.build_typescript_return_type())
            .map(|(outline, errors, _, start)| (outline, errors, start));
        if found != Some((expected.to_owned(), 0, next)) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

#[test]
fn the_type_parameters_of_a_row_end_at_their_closer() {
    for &(text, expected, close_end) in TYPE_PARAMETERS {
        let found = type_parameters_read(text);
        let expected = Some((expected.to_owned(), close_end));
        assert_eq!(found, expected, "{}", bstr::BStr::new(text));
    }
}

#[test]
fn a_lint_parse_reads_a_row_as_tsc_does() {
    let mut failed = Vec::new();
    for row in ROWS.iter().filter(|row| !is_known_difference(row)) {
        let found = lint_parse(row.dialect, row.text, facts);
        let passed = match (&row.want, &found) {
            (Want::Reads(want), Ok(found)) => found == want,
            (Want::Fails(code, start, end), Err(found)) => *found == (*code, *start, *end),
            _ => false,
        };
        if !passed {
            failed.push(format!("{} {:?} {}: {found:?}", row.family, row.dialect, bstr::BStr::new(row.text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}

/// Whether \`row\` is a source that a lint parse does not read as tsc does.
fn is_known_difference(row: &Row) -> bool {
    KNOWN_DIFFERENCES
        .iter()
        .any(|&(dialect, text, _)| dialect == row.dialect && text == row.text)
}

#[test]
fn a_lint_parse_makes_this_of_a_source_that_it_does_not_read_as_tsc_does() {
    let mut failed = Vec::new();
    for &(dialect, text, made) in KNOWN_DIFFERENCES {
        let found = lint_parse(dialect, text, kept).ok();
        if found.as_deref() != made {
            failed.push(format!("{dialect:?} {}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}
`);
emit(`/// Each text starts with a type of a row and goes on to the end of its source: the outline of the type, and where the token after it starts.`);
emit(`#[rustfmt::skip]`);
emit(`const TYPES: &[(&[u8], &str, usize)] = &[`);
for (const [rest, e] of typeTables.type) emit(`    (${bytes(rest)}, ${str(e.outline)}, ${e.next}),`);
emit(`];\n`);
emit(`/// The same for what follows the \`:\` after a parameter list.`);
emit(`#[rustfmt::skip]`);
emit(`const RETURN_TYPES: &[(&[u8], &str, usize)] = &[`);
for (const [rest, e] of typeTables.return) emit(`    (${bytes(rest)}, ${str(e.outline)}, ${e.next}),`);
emit(`];\n`);
emit(`/// The type parameter lists of the rows: the range of the list, the name and the range of each type parameter, and the offset after the \`>\`.`);
emit(`#[rustfmt::skip]`);
emit(`const TYPE_PARAMETERS: &[(&[u8], &str, u32)] = &[`);
for (const [text, e] of typeTables["type-parameters"]) emit(`    (${bytes(text)}, ${str(e.outline)}, ${e.closeEnd}),`);
emit(`];\n`);
const notReadRows = [...seen.values()].filter(e => notReadKeys.has(e.key));
emit(`/// The sources that a lint parse does not read as tsc does, with what it makes of each: \`None\` where it fails, else the tag of each statement it keeps.`);
emit(`#[rustfmt::skip]`);
emit(`const KNOWN_DIFFERENCES: &[(Dialect, &[u8], Option<&[&str]>)] = &[`);
for (const e of notReadRows) emit(`    (Dialect::${e.dialect}, ${bytes(e.text)}, ${e.without}),`);
emit(`];\n`);
emit(`/// The cases in groups, each group after the line that names it: a source, how it is read, and what tsc makes of it.`);
emit(`#[rustfmt::skip]`);
emit(`const ROWS: &[Row] = &[`);
for (const e of entries) {
  if (e.group) emit(`    // ${e.group.split("\0")[1]}`);
  emit(`    Row { family: ${str(e.family)}, dialect: Dialect::${e.dialect}, text: ${bytes(e.text)}, want: ${e.want} },`);
}
emit(`];\n`);
emit(`const _: () = assert!(ROWS.len() == ${entries.length});`);
let text = out.join("\n") + "\n";
if (notReadRows.length === 0) {
  // Every source is read: no table, no predicate, no fifth test.
  const drop = (from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error("no " + from); text = text.slice(0, a) + text.slice(b); };
  drop("/// Whether `row` is a source that a lint parse does not read as tsc does.", "/// Each text starts with a type of a row");
  drop("/// The sources that a lint parse does not read as tsc does", "/// The cases in groups, each group after the line");
  text = text.replace("    for row in ROWS.iter().filter(|row| !is_known_difference(row)) {", "    for row in ROWS {");
}
const outPath = process.env.OUT ?? here + "grammar_rows_tests.rs.out";
writeFileSync(outPath, text);
const wants = { Reads: 0, Fails: 0 };
for (const e of entries) wants[/^Want::(\w+)/.exec(e.want)[1]]++;
console.log(`${outPath}: ${typeTables.type.size} types, ${typeTables.return.size} return types, ${typeTables["type-parameters"].size} type parameter lists, ${entries.length} rows (${JSON.stringify(wants)}), ${seen.size} distinct sources, ${notReadRows.length} not read`);
