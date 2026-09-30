//! What a lint parse records of the type annotations, return types and `this` parameters of sources whose records are known.

use super::attached::{Attached, Owner};
use super::parse_entry::{Options, ParsedForLint, Parser};
use crate::defines::Define;
use bun_alloc::Arena;
use bun_ast::ts::{self, Metadata};
use bun_ast::{ExprData, Loader, StmtData};

struct Case {
    name: &'static str,
    path: &'static [u8],
    loader: Loader,
    text: &'static [u8],
    /// One line for each record: the annotations, then the `this` parameters, then the return types.
    records: &'static [&'static str],
}

/// What `check` makes of the lint parse of `text` as the file `path`. `None`: it does not parse.
fn lint_parse<R>(
    path: &'static [u8],
    loader: Loader,
    text: &'static [u8],
    emit_decorator_metadata: bool,
    check: impl FnOnce(&ParsedForLint<'_, '_>) -> R,
) -> Option<R> {
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    options.features.emit_decorator_metadata = emit_decorator_metadata;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    parser.parse_for_lint(check).ok()
}

/// The kind of `type_node` and its range.
fn described(type_node: ts::Type) -> String {
    let kind = type_node.data.kind_name();
    format!("{kind}[{},{})", type_node.start, type_node.end)
}

fn owned(owner: Owner) -> String {
    match owner {
        Owner::Fn(at) => format!("fn={at}"),
        Owner::Arrow(at) => format!("arrow={at}"),
        Owner::Class(at) => format!("class={at}"),
    }
}

/// A line for each annotation that has a type, for each `this` parameter and for each return type, list after list.
fn describe(attached: &Attached) -> Vec<String> {
    let mut lines = Vec::new();
    for record in &attached.annotations {
        if let Some(type_node) = record.type_node {
            let key = record.owner;
            lines.push(format!("type key={key} {}", described(type_node)));
        }
    }
    for record in &attached.this_parameters {
        let (owner, index) = (owned(record.owner), record.index);
        let (start, end) = (record.start, record.end);
        let type_node = record
            .type_node
            .map(|type_node| format!(" {}", described(type_node)))
            .unwrap_or_default();
        lines.push(format!(
            "this {owner} index={index} [{start},{end}){type_node}"
        ));
    }
    for record in &attached.return_types {
        let owner = owned(record.owner);
        lines.push(format!("return {owner} {}", described(record.type_node)));
    }
    lines
}

#[test]
fn records_are_those_of_the_known_sources() {
    let mut failed = Vec::new();
    for case in CASES {
        let records = case.records.iter().map(|line| (*line).to_owned()).collect();
        let expected: Option<Vec<String>> = Some(records);
        let found = lint_parse(case.path, case.loader, case.text, false, |parsed| {
            describe(&parsed.sidecar.attached)
        });
        if found != expected {
            failed.push(format!("{}: {found:#?}", case.name));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// How many annotations with a type, `this` parameters and return types the lint parse of `text` keeps.
fn record_count(text: &'static [u8]) -> Option<usize> {
    lint_parse(b"/a.ts", Loader::Ts, text, false, |parsed| {
        describe(&parsed.sidecar.attached).len()
    })
}

#[test]
fn what_an_attempt_read_and_took_back_leaves_no_record() {
    let without_attempt = record_count(b"x = T => function (d: D) {};\n");
    assert_eq!(without_attempt, Some(1));

    // The snapshot of the whole parser: "(b) : T => body" is read as an arrow function, and no ":" follows the body.
    let after_failed_attempt = record_count(b"x = c ? (b) : T => function (d: D) {};\n");
    assert_eq!(after_failed_attempt, without_attempt);

    // The same attempt holds: the body is read a second time, and its record is made once.
    let after_kept_attempt = record_count(b"x = c ? (b): T => function (d: D) {} : e;\n");
    assert_eq!(after_kept_attempt, Some(2));

    // The snapshot of the lexer alone: "<b>" is read as type arguments, and as type parameters of an arrow function.
    assert_eq!(record_count(b"let n: number = a < b > c;\n"), Some(1));
    assert_eq!(record_count(b"let w: W = <T>(y);\n"), Some(1));

    // An expression inside a type: what it declares goes away, and its records with it.
    let inside_a_type = record_count(b"let g: (a = function (b: B) {}) => void;\n");
    assert_eq!(inside_a_type, Some(1));
}

#[test]
fn a_decorated_member_keeps_its_metadata_beside_its_node() {
    let text: &'static [u8] = b"class C { @d x: Foo; y: Bar; @d m(a: Foo): Bar { return a } }\n";
    let found = lint_parse(b"/a.ts", Loader::Ts, text, true, |parsed| {
        let Some(StmtData::SClass(class)) = parsed.stmts.first().map(|stmt| stmt.data) else {
            return None;
        };
        let mut has_metadata = Vec::new();
        for property in class.class.properties.slice() {
            has_metadata.push(!matches!(property.ts_metadata, Metadata::MNone));
            let value = property.value.map(|value| value.data);
            if let Some(ExprData::EFunction(function)) = value {
                let func = &function.func;
                has_metadata.push(!matches!(func.return_ts_metadata, Metadata::MNone));
                for arg in func.args.slice() {
                    has_metadata.push(!matches!(arg.ts_metadata, Metadata::MNone));
                }
            }
        }
        Some((has_metadata, describe(&parsed.sidecar.attached)))
    });
    let records: Vec<String> = [
        "type key=13 TypeReference[16,19)",
        "type key=21 TypeReference[24,27)",
        "type key=34 TypeReference[37,40)",
        "return fn=33 TypeReference[43,46)",
    ]
    .iter()
    .map(|line| (*line).to_owned())
    .collect();
    // The field `x`, the field `y`, the method `m`, what `m` returns and its parameter.
    let has_metadata = vec![true, false, true, true, true];
    assert_eq!(found, Some(Some((has_metadata, records))));
}

/// The lines of the function of `source` that the line `head` starts, after that line: without indentation, and no comment and no empty line.
fn function_lines(source: &'static [u8], head: &[u8]) -> Vec<&'static [u8]> {
    let mut lines = Vec::new();
    let mut is_inside = false;
    for line in bun_core::strings::split(source, b"\n") {
        if !is_inside {
            is_inside = line == head;
            continue;
        }
        if line == b"    }".as_slice() {
            break;
        }
        let line = line.trim_ascii();
        if !line.is_empty() && !line.starts_with(b"//") {
            lines.push(line);
        }
    }
    lines
}

/// Where `parse_paren_expr_for_lint` differs from `parse_paren_expr`: lines of the one, and the lines of the other in their place.
const TWIN_DIFFERENCES: &[(&[&[u8]], &[&[u8]])] = &[
    (
        &[b"let mut arrow_arg_errors = DeferredArrowArgErrors::default();"],
        &[b"let arrow_arg_errors = DeferredArrowArgErrors::default();"],
    ),
    (
        &[b"p.skip_type_script_type(Level::Lowest)?;"],
        &[b"p.lint_type_annotation(arrow_parameter_loc(item))?;"],
    ),
    (&[b"if opts.is_async {", b"}"], &[]),
    (
        &[
            b"if opts.is_after_question_and_before_colon {",
            b"is_arrow_fn = p",
            b".is_type_script_arrow_return_type_after_question_and_before_colon(",
            b"&arrow_data,",
            b")?;",
            b"if is_arrow_fn {",
            b"p.lexer.next()?;",
            b"p.skip_typescript_return_type()?;",
            b"}",
            b"} else {",
            b"is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();",
            b"}",
        ],
        &[
            b"is_arrow_fn = p.lint_arrow_return_type(",
            b"loc,",
            b"&arrow_data,",
            b"opts.is_after_question_and_before_colon,",
            b")?;",
        ],
    ),
    (
        &[b"p.log_arrow_arg_errors(&mut arrow_arg_errors);"],
        &[b"log_arrow_arg_errors_for_lint(p.log(), p.source, arrow_arg_errors);"],
    ),
    (
        &[b"p.pop_and_flatten_scope(scope_index);"],
        &[
            b"pop_and_flatten_scope_for_lint(&mut p.current_scope, &mut p.scopes_in_order, scope_index);",
        ],
    ),
];

#[test]
fn the_lint_twin_of_parse_paren_expr_reads_what_it_reads() {
    let source: &'static [u8] = include_bytes!("mod.rs");
    let original = function_lines(source, b"    pub(crate) fn parse_paren_expr(");
    let twin = function_lines(source, b"    pub(crate) fn parse_paren_expr_for_lint(");
    assert!(!original.is_empty() && !twin.is_empty());

    let mut expected: Vec<&[u8]> = Vec::new();
    let mut uses = vec![0usize; TWIN_DIFFERENCES.len()];
    let mut at = 0;
    while let Some(rest) = original.get(at..).filter(|rest| !rest.is_empty()) {
        let difference = TWIN_DIFFERENCES
            .iter()
            .zip(uses.iter_mut())
            .find(|((from, _), _)| rest.starts_with(from));
        match difference {
            Some(((from, to), count)) => {
                expected.extend_from_slice(to);
                *count += 1;
                at += from.len();
            }
            None => {
                expected.extend(rest.first());
                at += 1;
            }
        }
    }
    assert!(
        uses.iter().all(|&count| count == 1),
        "parse_paren_expr changed where parse_paren_expr_for_lint differs from it: {uses:?}"
    );

    let first = expected
        .iter()
        .zip(twin.iter())
        .position(|(wanted, found)| wanted != found)
        .unwrap_or_else(|| expected.len().min(twin.len()));
    let line = |lines: &[&[u8]]| {
        lines
            .get(first)
            .map(|line| bstr::BStr::new(line).to_string())
    };
    assert!(
        expected == twin,
        "parse_paren_expr_for_lint is not parse_paren_expr with the known differences, at its line {first}: {:?} is wanted, {:?} is there",
        line(&expected),
        line(&twin),
    );
}

const CASES: &[Case] = &[
    Case {
        name: "variables",
        path: b"/a.ts",
        loader: Loader::Ts,
        text: b"let a: string = \"\", [b]: T[] = [], {c}: { c: U } = o;\nvar d: number;\nfor (const k: K of ks) {}\ntry {} catch (err: unknown) {}\ndeclare const dc: bigint;\n",
        records: &[
            "type key=4 StringKeyword[7,13)",
            "type key=20 ArrayType[25,28)",
            "type key=35 TypeLiteral[40,48)",
            "type key=58 NumberKeyword[61,67)",
            "type key=80 TypeReference[83,84)",
            "type key=109 UnknownKeyword[114,121)",
            "type key=140 BigIntKeyword[144,150)",
        ],
    },
    Case {
        name: "function-parameters",
        path: b"/a.ts",
        loader: Loader::Ts,
        text: b"function f(a: A, b?: B, ...c: C[]) {}\nconst g = function (x: X = y, { z }: Z) {};\nfunction over(a: string): void;\nfunction over(a: any) {}\ndeclare function dec(a: symbol): never;\n",
        records: &[
            "type key=11 TypeReference[14,15)",
            "type key=17 TypeReference[21,22)",
            "type key=27 ArrayType[30,33)",
            "type key=58 TypeReference[61,62)",
            "type key=68 TypeReference[75,76)",
            "type key=96 StringKeyword[99,105)",
            "type key=128 AnyKeyword[131,134)",
            "type key=160 SymbolKeyword[163,169)",
            "return fn=95 VoidKeyword[108,112)",
            "return fn=159 NeverKeyword[172,177)",
        ],
    },
    Case {
        name: "this-parameters",
        path: b"/a.ts",
        loader: Loader::Ts,
        text: b"function f(this: Window, a: A) {}\nfunction g(this) {}\nfunction h(a, this: T) {}\n",
        records: &[
            "type key=25 TypeReference[28,29)",
            "this fn=10 index=0 [11,15) TypeReference[17,23)",
            "this fn=44 index=0 [45,49)",
            "this fn=64 index=1 [68,72) TypeReference[74,75)",
        ],
    },
    Case {
        name: "return-types-and-predicates",
        path: b"/a.ts",
        loader: Loader::Ts,
        text: b"function f(): void {}\nfunction p(x: any): x is string { return true }\nfunction q(x: any): asserts x is string {}\nfunction r(x: any): asserts x {}\nclass C { m(): this is D { return true } }\nconst o = { get a(): A { return 1 }, set a(v: A) {}, m(u: U): R { return u } };\n",
        records: &[
            "type key=33 AnyKeyword[36,39)",
            "type key=81 AnyKeyword[84,87)",
            "type key=124 AnyKeyword[127,130)",
            "type key=232 TypeReference[235,236)",
            "type key=244 TypeReference[247,248)",
            "return fn=10 VoidKeyword[14,18)",
            "return fn=32 TypePredicate[42,53)",
            "return fn=80 TypePredicate[90,109)",
            "return fn=123 TypePredicate[133,142)",
            "return fn=157 TypePredicate[161,170)",
            "return fn=206 TypeReference[210,211)",
            "return fn=243 TypeReference[251,252)",
        ],
    },
    Case {
        name: "class-members",
        path: b"/a.ts",
        loader: Loader::Ts,
        text: b"class C { a: A = 1; static b?: B; c!: C; readonly [k]: D; declare e: E; accessor f: F; #g: G; m(this: C, a: T): T { return a } get x(): X { return 1 } set x(v: X) {} constructor(private p: P, q?: Q) {} }\nabstract class K { abstract m(a: U): T; abstract p: T }\n",
        records: &[
            "type key=10 TypeReference[13,14)",
            "type key=27 TypeReference[31,32)",
            "type key=34 TypeReference[38,39)",
            "type key=51 TypeReference[55,56)",
            "type key=66 TypeReference[69,70)",
            "type key=81 TypeReference[84,85)",
            "type key=87 TypeReference[91,92)",
            "type key=105 TypeReference[108,109)",
            "type key=157 TypeReference[160,161)",
            "type key=186 TypeReference[189,190)",
            "type key=192 TypeReference[196,197)",
            "type key=234 TypeReference[237,238)",
            "type key=253 TypeReference[256,257)",
            "this fn=95 index=0 [96,100) TypeReference[102,103)",
            "return fn=95 TypeReference[112,113)",
            "return fn=132 TypeReference[136,137)",
            "return fn=233 TypeReference[241,242)",
        ],
    },
    Case {
        name: "arrows",
        path: b"/a.ts",
        loader: Loader::Ts,
        text: b"const f = (a: A, b?: B, ...c: C[]): R => a;\nconst g = ({ a, b = 1 }: P, [c]: Q = []) => a;\nconst h = async (a: A): Promise<A> => a;\nconst i = <T,>(a: T): T => a;\nconst j = async <T,>(a: T): T => a;\nconst k = (a: any): a is A => true;\nconst l = c ? (a: A): B => a : d;\nx = (a) => a;\n",
        records: &[
            "type key=11 TypeReference[14,15)",
            "type key=17 TypeReference[21,22)",
            "type key=27 ArrayType[30,33)",
            "type key=55 TypeReference[69,70)",
            "type key=72 TypeReference[77,78)",
            "type key=108 TypeReference[111,112)",
            "type key=147 TypeReference[150,151)",
            "type key=183 TypeReference[186,187)",
            "type key=209 AnyKeyword[212,215)",
            "type key=249 TypeReference[252,253)",
            "return arrow=10 TypeReference[36,37)",
            "return arrow=101 TypeReference[115,125)",
            "return arrow=142 TypeReference[154,155)",
            "return arrow=172 TypeReference[190,191)",
            "return arrow=208 TypePredicate[218,224)",
            "return arrow=248 TypeReference[256,257)",
        ],
    },
    Case {
        name: "arrows-in-tsx",
        path: b"/a.tsx",
        loader: Loader::Tsx,
        text: b"const f = <T,>(a: T): T => a;\nconst g = <T extends U>(a: T) => a;\n",
        records: &[
            "type key=15 TypeReference[18,19)",
            "type key=54 TypeReference[57,58)",
            "return arrow=10 TypeReference[22,23)",
        ],
    },
    Case {
        name: "javascript",
        path: b"/a.js",
        loader: Loader::Js,
        text: b"const f = (a, b = 1) => a;\nfunction g(c) {}\nx = c ? (b) : d => e;\n",
        records: &[],
    },
];
