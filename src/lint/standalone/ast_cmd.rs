//! `bun-lint ast ..`
//!
//! - `estree <file> [--espree]`: the ESTree of a file as JSON, as typescript-estree or as espree
//!   has it.
//! - `estree-batch <inputs.jsonl> [--espree]`: the same for many. A line of the input is
//!   `{"id": .., "filename": .., "code": ..}`, a line of the output `{"id": .., "ast": ..}` or
//!   `{"id": .., "error": ..}`.
//! - `schema`: the types of ESTree nodes with their fields and visitor keys, as JSON.
//! - `check <file>..`: whether `bun_lint::ast` is consistent with itself for these files.
//! - `check-batch <inputs.jsonl>`: the same for many, summarized by the kind of problem.
//! - `bench <file>`: how long the ways through a file take.
//! - `bind-check <inputs.jsonl> [--espree] [--format]`: whether `bind_for_lint` has what `bind` has, in
//!   all that `bun_lint::ast` and `bun_lint::semantic` read of it. `--format`: whether
//!   `bind_for_format` has, in what it promises.

#[path = "estree/json.rs"]
mod estree_json;

use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{
    ExprKind, ExprTag, File, FnKind, Key, List, Modifier, NOT_IN_TREE, Node, PatTag, StmtKind, StmtTag, TypeKind, TypeTag,
    assign_op_text, bin_op_text, un_op_text,
};
use bun_lint::context::Severity;
use bun_lint::estree_for_tests::{NodeType, VNode, Value};
use bun_lint::language::{Parser, SourceType};
use bun_lint::language::LanguageOptions;
use bun_lint::options::{Json, Options};
use bun_lint::rule::{Kind, Listeners, Meta, Rule};
use bun_lint::runner::Enabled;
use bun_lint::span::Span;
use std::collections::{BTreeMap, HashMap};
use std::io::Write as _;
use std::sync::Mutex;

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path, flags @ ..] if command == "estree" => estree(path, &language_of(flags)),
        [command, path, flags @ ..] if command == "estree-batch" => estree_batch(path, &language_of(flags)),
        [command] if command == "schema" => schema(),
        [command, path] if command == "parts" => parts(path),
        [command, paths @ ..] if command == "check" && !paths.is_empty() => check_files(paths),
        [command, path] if command == "check-batch" => check_batch(path),
        [command, path] if command == "bench" => bench(path),
        [command, path, flags @ ..] if command == "bind-check" => {
            bind_check(path, &language_of(flags), flags.iter().any(|it| it == "--format"));
        }
        _ => println!("usage: bun-lint ast estree|estree-batch|check|check-batch|bench <path>"),
    }
}

// ───────────────────────────── inputs ─────────────────────────────

/// What makes the ESTree that of `@typescript-eslint/parser`, or with `--espree` that of espree, for
/// a module.
fn language_of(flags: &[String]) -> LanguageOptions {
    match flags.iter().any(|it| it == "--espree") {
        true => LanguageOptions::default(),
        false => LanguageOptions {
            parser: Parser::TypeScript,
            ..LanguageOptions::default()
        },
    }
}

struct Input {
    id: String,
    filename: String,
    code: Vec<u8>,
    /// `languageOptions.sourceType`, which espree goes by.
    source_type: SourceType,
}

fn read_inputs(path: &str) -> Vec<Input> {
    let text = std::fs::read(path).expect("the inputs");
    let lines = bun_core::strings::split(&text, b"\n").filter(|line| !line.is_empty());
    let inputs = lines.filter_map(|line| {
        let json = bun_lint::json::parse(line)?;
        let field = |name: &[u8]| json.get(name).and_then(Json::as_str).map(<[u8]>::to_vec);
        Some(Input {
            id: String::from_utf8_lossy(&field(b"id")?).into_owned(),
            filename: String::from_utf8_lossy(&field(b"filename")?).into_owned(),
            code: field(b"code")?,
            source_type: match field(b"sourceType").as_deref() {
                Some(b"script") => SourceType::Script,
                Some(b"commonjs") => SourceType::CommonJs,
                _ => SourceType::Module,
            },
        })
    });
    inputs.collect()
}

/// Calls `then` with the file of `input`. `Err` if it panics.
fn with_input<R>(
    input: &Input,
    language: &LanguageOptions,
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> Result<R, String> {
    let language = match language.parser {
        Parser::Espree => &LanguageOptions {
            source_type: input.source_type,
            jsx: true,
            ..LanguageOptions::default()
        },
        _ => &LanguageOptions {
            parser: Parser::TypeScript,
            source_type: input.source_type,
            ..LanguageOptions::default()
        },
    };
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::with_file(&input.filename, &input.code, language, then)
    }));
    outcome.map_err(|panic| match panic.downcast_ref::<String>() {
        Some(message) => message.clone(),
        None => (panic.downcast_ref::<&str>()).map_or("?".to_owned(), |it| (*it).to_owned()),
    })
}

// ───────────────────────────── ESTree ─────────────────────────────

fn estree(path: &str, language: &LanguageOptions) {
    let code = std::fs::read(path).expect("the file");
    crate::with_file(path, &code, language, |file| {
        if file.has_parse_errors() {
            return println!("the parser rejects the code");
        }
        let mut out = Vec::new();
        estree_json::write_json(file, &mut out);
        out.push(b'\n');
        let _ = std::io::stdout().write_all(&out);
    });
}

fn estree_batch(path: &str, language: &LanguageOptions) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    let mut out = Vec::new();
    for input in read_inputs(path) {
        out.clear();
        let _ = write!(out, "{{\"id\":{:?},\"ast\":", input.id);
        let prefix = out.len();
        let outcome = with_input(&input, language, |file| match file.has_parse_errors() {
            true => Err("parse".to_owned()),
            false => {
                estree_json::write_json(file, &mut out);
                Ok(())
            }
        });
        if let Err(error) = outcome.map_err(|panic| format!("panic: {panic}")).flatten() {
            out.truncate(prefix - "\"ast\":".len());
            let _ = write!(out, "\"error\":{error:?}");
        }
        out.extend_from_slice(b"}\n");
        let _ = stdout.write_all(&out);
    }
}

/// The fields in which a child is made of the same node of `bun_lint::ast` as its parent.
fn parts(path: &str) {
    let mut found = std::collections::BTreeSet::new();
    for input in read_inputs(path) {
        let _ = with_input(&input, &language_of(&[]), |file| {
            let mut pending = vec![VNode::program(file)];
            while let Some(v) = pending.pop() {
                for entry in v.node_type().fields().iter().take_while(|it| it.is_child) {
                    let is_part = match (entry.get)(v) {
                        Value::Node(it) => it.base() == v.base(),
                        Value::Nodes(list) => list.flatten().any(|it| it.base() == v.base()),
                        _ => false,
                    };
                    if is_part {
                        found.insert(format!("{}.{:?}", v.node_type().name(), entry.field));
                    }
                }
                v.for_each_child(|child| pending.push(child));
            }
        });
    }
    found.iter().for_each(|it| println!("{it}"));
}

fn schema() {
    let mut types = Vec::new();
    for node_type in NodeType::ALL {
        let names = |only: &dyn Fn(&bun_lint::estree_for_tests::FieldEntry) -> bool| {
            let fields = node_type.fields().iter().filter(|it| only(it));
            fields.map(|it| format!("{:?}", it.field.name())).collect::<Vec<_>>().join(",")
        };
        types.push(format!(
            "{:?}:{{\"keys\":[{}],\"espreeKeys\":[{}],\"fields\":[{}],\"espreeFields\":[{}]}}",
            node_type.name(),
            names(&|it| it.is_child && !it.is_espree_only),
            names(&|it| it.is_child && !it.is_typescript_only),
            names(&|it| !it.is_espree_only && !it.is_hidden),
            names(&|it| !it.is_typescript_only),
        ));
    }
    println!("{{{}}}", types.join(","));
}

// ───────────────────────────── self-check ─────────────────────────────

/// `Expr::Dot`, `Stmt::For`, `Func::Arrow`
fn describe(node: Node) -> String {
    match node {
        Node::File(_) => "File".to_owned(),
        Node::Expr(it) => format!("Expr::{:?}", it.tag()),
        Node::Stmt(it) => format!("Stmt::{:?}", it.tag()),
        Node::Type(it) => format!("Type::{:?}", it.tag()),
        Node::Pat(it) => format!("Pat::{:?}", it.tag()),
        Node::Func(it) => format!("Func::{:?}", it.kind()),
        Node::Member(it) => format!("Member::{:?}", it.kind()),
        Node::Prop(it) => format!("Prop::{:?}", it.kind()),
        Node::PatProp(_) => "PatProp".to_owned(),
        Node::PatElem(_) => "PatElem".to_owned(),
        Node::Param(_) => "Param".to_owned(),
        Node::TypeParam(_) => "TypeParam".to_owned(),
        Node::Class(_) => "Class".to_owned(),
        Node::VarDecl(_) => "VarDecl".to_owned(),
        Node::Case(_) => "Case".to_owned(),
        Node::EnumMember(_) => "EnumMember".to_owned(),
        Node::ImportSpec(_) => "ImportSpec".to_owned(),
        Node::ExportSpec(_) => "ExportSpec".to_owned(),
        Node::TupleElem(_) => "TupleElem".to_owned(),
    }
}

/// A kind of problem, and where it is.
type Problem = (String, String);

fn place(node: Node) -> String {
    let span = node.span();
    let text = String::from_utf8_lossy(node.text()).into_owned();
    let short: String = text.chars().take(60).collect();
    format!("{node:?} {}..{} {short:?}", span.start, span.end)
}

/// Goes down from the file by `for_each_child` and checks each edge.
fn check_tree<'a>(file: &'a File<'a>, problems: &mut Vec<Problem>) -> HashMap<Node<'a>, u32> {
    let mut reached: HashMap<Node, u32> = HashMap::new();
    let mut pending = vec![Node::File(file)];
    let text = file.text();
    let is_space = |at: u32| text.get(at as usize).is_some_and(u8::is_ascii_whitespace);
    while let Some(node) = pending.pop() {
        let times = reached.entry(node).or_insert(0);
        *times += 1;
        if *times > 1 {
            problems.push((format!("reached twice: {}", describe(node)), place(node)));
            continue;
        }
        let span = node.span();
        let is_jsx_text = matches!(node, Node::Expr(e) if matches!(e.kind(), ExprKind::String(_))
            && matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Jsx(_))));
        if span.start > span.end || span.end as usize > text.len() {
            problems.push((format!("span is not a range: {}", describe(node)), place(node)));
        } else if !matches!(node, Node::File(_))
            && !is_jsx_text
            && (span.is_empty() || is_space(span.start) || is_space(span.end - 1))
        {
            problems.push((format!("span is empty or starts or ends with a space: {}", describe(node)), place(node)));
        }
        check_positions(node, problems);
        let mut previous_end = span.start;
        node.for_each_child(|child| {
            let edge = || format!("{} in {}", describe(child), describe(node));
            if child.parent() != node {
                let actual = describe(child.parent());
                problems.push((format!("parent of {} is {actual}", edge()), place(child)));
            }
            let inner = match child {
                Node::Expr(e) => e.outer_span(),
                Node::Type(t) => t.outer_span(),
                // The span of the function of a method is that of the method.
                Node::Func(f) if matches!(node, Node::Member(_)) => f.span_from_params(),
                Node::Func(f) => f.estree_span(),
                _ => child.span(),
            };
            if !span.contains(inner) {
                problems.push((format!("outside of its parent: {}", edge()), format!("{} in {}", place(child), place(node))));
            }
            if inner.start < previous_end {
                problems.push((format!("out of order: {}", edge()), format!("{} in {}", place(child), place(node))));
            }
            previous_end = inner.end;
            pending.push(child);
        });
    }
    reached
}

type Expect<'e> = &'e mut dyn FnMut(&str, Option<Span>, &dyn Fn(&[u8]) -> bool);

fn within(open: u8, close: u8) -> impl Fn(&[u8]) -> bool {
    move |text: &[u8]| text.len() >= 2 && text[0] == open && text[text.len() - 1] == close
}

fn modifiers<'a>(list: List<'a, Modifier<'a>>, expect: Expect) {
    for modifier in list {
        match modifier.decorator() {
            Some(_) => expect("decorator", Some(modifier.span()), &|text| text.starts_with(b"@")),
            None => expect("modifier", Some(modifier.span()), &|text| text.iter().all(u8::is_ascii_lowercase)),
        }
    }
}

fn key<'a>(file: &'a File<'a>, key: Option<Key<'a>>, expect: Expect) {
    let Some(key) = key else { return };
    let (outer, inner) = (key.span(file), key.inner_span(file));
    match key.is_computed() {
        true => {
            expect("Key::span", Some(outer), &within(b'[', b']'));
            expect("Key::inner_span", Some(inner), &|text| !text.is_empty() && outer.contains(inner) && outer != inner);
        }
        false => expect("Key::span", Some(outer), &|text| {
            let is_quoted = matches!(text.first(), Some(b'"' | b'\''));
            !text.is_empty() && outer == inner && (is_quoted || !text.iter().any(u8::is_ascii_whitespace))
        }),
    }
}

/// Checks the positions of tokens that the accessors of `node` return against the text.
fn check_positions<'a>(node: Node<'a>, problems: &mut Vec<Problem>) {
    let file = node.file();
    let mut expect = |what: &str, span: Option<Span>, is_right: &dyn Fn(&[u8]) -> bool| {
        if let Some(span) = span
            && !is_right(file.slice(span))
        {
            let found = String::from_utf8_lossy(file.slice(span)).chars().take(30).collect::<String>();
            problems.push((format!("{what} of {}", describe(node)), format!("{found:?} in {}", place(node))));
        }
    };
    let at = |offset: Option<u32>| offset.map(|it| Span::new(it, it + 1));
    let is = |token: &'static str| move |text: &[u8]| text == token.as_bytes();
    let angles = within(b'<', b'>');
    let braces = within(b'{', b'}');
    let annotation = |text: &[u8]| text.starts_with(b":") || text.starts_with(b"=>");
    match node {
        Node::Expr(e) => {
            for parens in e.parens() {
                expect("Expr::parens", Some(parens), &within(b'(', b')'));
            }
            if e.is_parenthesized() != (e.parens().len() > 0) || e.outer_span() != e.parens().next_back().unwrap_or(e.span()) {
                expect("Expr::is_parenthesized", Some(e.span()), &|_| false);
            }
            expect("Expr::jsx_container_span", e.jsx_container_span(), &braces);
            match e.kind() {
                ExprKind::Unary { op, .. } => expect("operator_span", e.operator_span(), &|text| text == un_op_text(op).as_bytes()),
                ExprKind::Binary { op, .. } => expect("operator_span", e.operator_span(), &|text| text == bin_op_text(op).as_bytes()),
                ExprKind::Assign { op, .. } => {
                    // The default of `{ a = 1 }` and the like.
                    expect("operator_span", e.operator_span(), &|text| text == assign_op_text(op).as_bytes());
                }
                ExprKind::Call(call) | ExprKind::New(call) => {
                    expect("Call::close_paren", at(call.close_paren()), &is(")"));
                    expect("type_args", call.type_args().angle_brackets_span(), &angles);
                }
                ExprKind::Dot { name, .. } => expect("Dot::name", Some(name.span()), &|text| !text.is_empty() && e.span().end == name.span().end),
                ExprKind::Template(template) => {
                    for i in 0..template.quasi_count() {
                        let is_last = i + 1 == template.quasi_count();
                        expect("Template::quasi_span", Some(template.quasi_span(i)), &|text| {
                            text.starts_with(if i == 0 { b"`" } else { b"}" }) && text.ends_with(if is_last { b"`" } else { b"${" })
                        });
                    }
                }
                ExprKind::AsConst(_) => expect("const_keyword_span", e.const_keyword_span(), &is("const")),
                ExprKind::Jsx(jsx) => {
                    expect("Jsx::opening_span", Some(jsx.opening_span()), &angles);
                    expect("Jsx::closing_span", jsx.closing_span(), &|text| text.starts_with(b"<") && text.ends_with(b">"));
                    expect("type_args", jsx.type_args().angle_brackets_span(), &angles);
                }
                ExprKind::Regex(regex) => expect("Regex", Some(e.span()), &|text| {
                    text.len() == regex.pattern().len() + regex.flags().len() + 2 && regex.flags().iter().all(u8::is_ascii_alphabetic)
                }),
                _ => {}
            }
        }
        Node::Type(ty) => {
            expect("TypeNode::outer_span", ty.is_parenthesized().then(|| ty.outer_span()), &within(b'(', b')'));
            match ty.kind() {
                TypeKind::Ref { name, args } => {
                    expect("type_args", args.angle_brackets_span(), &angles);
                    expect("EntityName::span", Some(name.span()), &|text| !text.is_empty() && name.span().start == ty.span().start);
                }
                TypeKind::UniqueSymbol => expect("unique_symbol_keyword_span", ty.unique_symbol_keyword_span(), &is("symbol")),
                TypeKind::Import { .. } => {
                    expect("import_span", ty.import_span(), &|text| text.starts_with(b"import"));
                    expect("import_source_span", ty.import_source_span(), &|text| matches!(text.first(), Some(b'"' | b'\'')));
                }
                _ => {}
            }
        }
        Node::Func(func) => {
            let open: &'static str = if func.kind() == FnKind::IndexSignature { "[" } else { "(" };
            let close: &'static str = if func.kind() == FnKind::IndexSignature { "]" } else { ")" };
            expect("Func::open_paren", at(func.open_paren()), &is(open));
            expect("Func::close_paren", at(func.close_paren()), &is(close));
            expect("Func::arrow_span", func.arrow_span(), &is("=>"));
            expect("Func::body_span", func.body_span(), &braces);
            expect("Func::params_span", func.params_span().filter(|_| func.close_paren().is_some()), &|text| {
                text.starts_with(open.as_bytes()) && text.ends_with(close.as_bytes())
            });
            expect("type_params", func.type_params().angle_brackets_span(), &angles);
            expect("return_type", func.return_type().map(|it| it.annotation_span()), &annotation);
            expect("Func::name", func.name().map(|it| it.span()), &|text| !text.is_empty());
            if !matches!(func.kind(), FnKind::Arrow | FnKind::StaticBlock) {
                expect("Func::span_from_params", Some(func.span_from_params()), &|text| matches!(text.first(), Some(b'(' | b'<' | b'[')));
            }
        }
        Node::Param(param) => {
            modifiers(param.modifiers(), &mut expect);
            expect("Param::ty", param.ty().map(|it| it.annotation_span()), &annotation);
            expect("Param::binding_span", Some(param.binding_span()), &|_| param.span().contains(param.binding_span()));
            expect("Param::span_without_modifiers", Some(param.span_without_modifiers()), &|text| {
                text.starts_with(b"...") == param.is_rest() && param.span_without_modifiers().contains(param.binding_span())
            });
        }
        Node::Class(class) => {
            modifiers(class.modifiers(), &mut expect);
            expect("Class::keyword_span", Some(class.keyword_span()), &is("class"));
            expect("Class::body_span", Some(class.body_span()), &braces);
            expect("type_params", class.type_params().angle_brackets_span(), &angles);
            expect("extends_args", class.extends_args().angle_brackets_span(), &angles);
        }
        Node::Member(member) => {
            modifiers(member.modifiers(), &mut expect);
            key(file, member.key(), &mut expect);
            expect("Member::ty", member.ty().map(|it| it.annotation_span()), &annotation);
            expect("constructor_keyword", member.constructor_keyword().map(|it| it.span()), &|text| {
                text == b"constructor" || text.get(1..text.len() - 1) == Some(b"constructor")
            });
        }
        Node::Prop(prop) => key(file, prop.key(), &mut expect),
        Node::PatProp(prop) => key(file, prop.key(), &mut expect),
        Node::EnumMember(member) => key(file, member.key(), &mut expect),
        Node::VarDecl(declaration) => expect("VarDecl::ty", declaration.ty().map(|it| it.annotation_span()), &annotation),
        Node::Stmt(statement) => {
            modifiers(statement.modifiers(), &mut expect);
            expect("Stmt::semicolon", statement.semicolon(), &is(";"));
            expect("Stmt::export_span", statement.export_span(), &|text| text.starts_with(b"export"));
            expect("Stmt::catch_clause_span", statement.catch_clause_span(), &|text| text.starts_with(b"catch") && text.ends_with(b"}"));
            expect("Stmt::module_specifier_span", statement.module_specifier_span(), &|text| matches!(text.first(), Some(b'"' | b'\'')));
            expect("Stmt::label", statement.label().map(|it| it.span()), &|text| !text.is_empty());
            match statement.kind() {
                StmtKind::Interface(it) => {
                    expect("Interface::body_span", Some(it.body_span()), &braces);
                    expect("type_params", it.type_params().angle_brackets_span(), &angles);
                }
                StmtKind::Enum(it) => expect("Enum::body_span", Some(it.body_span()), &braces),
                StmtKind::Module(it) => expect("Module::body_span", it.body_span(), &braces),
                StmtKind::TypeAlias(it) => expect("type_params", it.type_params().angle_brackets_span(), &angles),
                StmtKind::Block(_) => expect("Block", Some(statement.span()), &braces),
                StmtKind::ImportEquals(it) => expect("require_span", it.require_span(), &|text| text.starts_with(b"require") && text.ends_with(b")")),
                StmtKind::Import(it) => {
                    expect("namespace_span", it.namespace_span(), &|text| text.starts_with(b"*"));
                    if let Some(attributes) = it.attributes() {
                        expect("ImportAttributes::keyword_span", Some(attributes.keyword_span()), &|text| text == b"with" || text == b"assert");
                        expect("ImportAttributes::braces_span", Some(attributes.braces_span()), &braces);
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}

/// Goes down the virtual ESTree and checks each edge, and compares accessors of `bun_lint::ast` that
/// answer from below with the tree, which is made from above.
fn check_estree<'a>(file: &'a File<'a>, reached: &HashMap<Node<'a>, u32>, problems: &mut Vec<Problem>) {
    let describe_v = |v: VNode| format!("{} of {}", v.node_type().name(), describe(v.base()));
    let place_v = |v: VNode| format!("{v:?} {:?} {:?}", v.span(), String::from_utf8_lossy(file.slice(v.span())).chars().take(50).collect::<String>());
    let mut all: HashMap<VNode, u32> = HashMap::new();
    let (mut chains, mut directives) = (Vec::new(), Vec::new());
    let mut pending = vec![VNode::program(file)];
    while let Some(v) = pending.pop() {
        let times = all.entry(v).or_insert(0);
        *times += 1;
        if *times > 1 {
            problems.push((format!("estree: reached twice: {}", describe_v(v)), place_v(v)));
            continue;
        }
        let node_type = v.node_type();
        if !node_type.listens_to().contains(v.base()) {
            problems.push((format!("estree: listens_to lacks {}", describe_v(v)), place_v(v)));
        }
        if node_type == NodeType::ChainExpression {
            chains.push(v.span());
        }
        // typescript-estree has directives in static blocks, ESLint's own parser has not.
        let in_static_block = v.parent().is_some_and(|it| it.node_type() == NodeType::StaticBlock);
        if !in_static_block && matches!(v.field(bun_lint::estree_for_tests::Field::Directive), Value::Str(_)) {
            directives.push(v.span());
        }
        for entry in node_type.fields().iter().filter(|it| it.is_child && !it.is_part) {
            let is_part = match (entry.get)(v) {
                Value::Node(it) => it.base() == v.base(),
                Value::Nodes(list) => list.flatten().any(|it| it.base() == v.base()),
                _ => false,
            };
            if is_part {
                problems.push((format!("estree: {}.{:?} is a part", node_type.name(), entry.field), place_v(v)));
            }
        }
        v.for_each_child(|child| {
            if child.parent() != Some(v) {
                let actual = child.parent().map_or("none".to_owned(), describe_v);
                let kind = format!("estree: parent of {} in {} is {actual}", describe_v(child), describe_v(v));
                problems.push((kind, place_v(child)));
            }
            pending.push(child);
        });
    }
    // Every node is found from the node of `bun_lint::ast` that it is made of, and nothing else.
    let mut found: HashMap<VNode, u32> = HashMap::new();
    for &node in reached.keys() {
        VNode::for_each_at(node, &mut |v| *found.entry(v).or_insert(0) += 1);
    }
    for (&v, &times) in &found {
        if times > 1 {
            problems.push((format!("estree: for_each_at finds twice: {}", describe_v(v)), place_v(v)));
        }
        if !all.contains_key(&v) {
            problems.push((format!("estree: for_each_at finds what is not in the tree: {}", describe_v(v)), place_v(v)));
        }
    }
    for &v in all.keys() {
        if !found.contains_key(&v) {
            problems.push((format!("estree: for_each_at does not find {}", describe_v(v)), place_v(v)));
        }
    }
    let (mut chain_roots, mut with_directive) = (Vec::new(), Vec::new());
    for &node in reached.keys() {
        match node {
            Node::Expr(e) if e.is_chain_root() => chain_roots.push(e.span()),
            Node::Stmt(s) if s.directive().is_some() => with_directive.push(s.span()),
            _ => {}
        }
    }
    for (what, mut expected, mut actual) in
        [("is_chain_root", chains, chain_roots), ("directive", directives, with_directive)]
    {
        expected.sort();
        actual.sort();
        if expected != actual {
            problems.push((format!("{what} differs from the ESTree"), format!("{expected:?} {actual:?}")));
        }
    }
}

/// What the rule below finds.
/// Whether the kinds of all the elements of a vector of the HIR at once are those of the nodes that are reached, and of
/// nothing else.
fn check_tags<'a>(file: &'a File<'a>, reached: &HashMap<Node<'a>, u32>, problems: &mut Vec<Problem>) {
    let [mut exprs, mut stmts, mut types, mut pats] = [const { Vec::new() }; 4];
    file.expr_tags_in_tree(&mut exprs);
    file.stmt_tags_in_tree(&mut stmts);
    file.type_tags_in_tree(&mut types);
    file.pat_tags_in_tree(&mut pats);
    let mut counts = [0usize; 4];
    for &node in reached.keys() {
        let (sort, tags, id, tag) = match node {
            Node::Expr(it) => (0, &exprs, it.id().idx(), it.tag() as u8),
            Node::Stmt(it) => (1, &stmts, it.id().idx(), it.tag() as u8),
            Node::Type(it) => (2, &types, it.id().idx(), it.tag() as u8),
            Node::Pat(it) => (3, &pats, it.id().idx(), it.tag() as u8),
            _ => continue,
        };
        counts[sort] += 1;
        if tags.get(id) != Some(&tag) {
            problems.push((format!("in the tree, another kind in the list of all: {}", describe(node)), place(node)));
        }
    }
    for (name, tags, count) in [("Expr", &exprs, counts[0]), ("Stmt", &stmts, counts[1]), ("Type", &types, counts[2]), ("Pat", &pats, counts[3])] {
        let listed = tags.iter().filter(|&&tag| tag != NOT_IN_TREE).count();
        if listed != count {
            problems.push((format!("the list of all has {name}s that are not in the tree"), format!("{listed} and {count}")));
        }
    }
}

static FOUND: Mutex<Vec<Problem>> = Mutex::new(Vec::new());

/// Listens for everything, and compares what it is called with to what a walk reaches.
struct Everything;

const EXPR_TAGS: [ExprTag; ExprTag::COUNT] = {
    use ExprTag::*;
    [
        Missing, Ident, PrivateIdentifier, This, Super, Null, True, False, Number, String, BigInt, Regex, Template,
        TaggedTemplate, Array, Object, Fn, Class, Dot, Index, Call, New, Unary, Binary, Assign, Cond, Spread, Await,
        Yield, As, Satisfies, AsConst, NonNull, Instantiation, Jsx, ImportCall, ImportMeta, NewTarget,
    ]
};

impl Rule for Everything {
    const META: Meta = Meta::eslint("everything", Kind::Problem);
    type State<'a> = HashMap<Node<'a>, u32>;

    fn new(_: &Options) -> Self {
        Everything
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.exprs(EXPR_TAGS, |_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.stmts(StmtTag::ALL, |_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.types(TypeTag::ALL, |_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.pats(PatTag::ALL, |_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.funcs(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.classes(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.members(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.props(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.params(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.type_params(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.var_decls(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.cases(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.enum_members(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.import_specs(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.export_specs(|_, it, cx| *cx.state.entry(it.into()).or_insert(0) += 1);
        on.finish(|_, cx| {
            let mut problems = Vec::new();
            let reached = check_tree(cx.file(), &mut problems);
            check_estree(cx.file(), &reached, &mut problems);
            check_tags(cx.file(), &reached, &mut problems);
            for (&node, &times) in &cx.state {
                if times > 1 {
                    problems.push((format!("listener called twice: {}", describe(node)), place(node)));
                }
                if !reached.contains_key(&node) {
                    problems.push((format!("listener called, not in the tree: {}", describe(node)), place(node)));
                }
            }
            for &node in reached.keys() {
                let has_listener =
                    !matches!(node, Node::File(_) | Node::PatProp(_) | Node::PatElem(_) | Node::TupleElem(_));
                if has_listener && !cx.state.contains_key(&node) {
                    problems.push((format!("in the tree, no listener called: {}", describe(node)), place(node)));
                }
            }
            FOUND.lock().unwrap().append(&mut problems);
        });
        HashMap::new()
    }
}

fn check<'a>(file: &'a File<'a>) -> Vec<Problem> {
    let rules = [Enabled {
        rule: &Everything,
        severity: Severity::Error,
    }];
    bun_lint::runner::run(file, &rules, false);
    let mut problems = std::mem::take(&mut *FOUND.lock().unwrap());
    problems.sort();
    problems
}

fn check_files(paths: &[String]) {
    for path in paths {
        let code = std::fs::read(path).expect("the file");
        crate::with_file(path, &code, &language_of(&[]), |file| {
            if file.has_parse_errors() {
                return println!("{path}: the parser rejects the code");
            }
            for (kind, place) in check(file) {
                println!("{path}: {kind}: {place}");
            }
        });
    }
}

fn check_batch(path: &str) {
    std::panic::set_hook(Box::new(|_| {}));
    let inputs = read_inputs(path);
    let (mut checked, mut rejected, mut with_problems) = (0, 0, 0);
    let mut by_kind: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
    for input in &inputs {
        let outcome = with_input(input, &language_of(&[]), |file| (!file.has_parse_errors()).then(|| check(file)));
        let problems = match outcome {
            Ok(None) => {
                rejected += 1;
                continue;
            }
            Ok(Some(problems)) => problems,
            Err(panic) => {
                FOUND.clear_poison();
                vec![(format!("panic: {panic}"), String::new())]
            }
        };
        checked += 1;
        with_problems += usize::from(!problems.is_empty());
        for (kind, place) in problems {
            let (count, examples) = by_kind.entry(kind).or_default();
            *count += 1;
            if examples.len() < 3 && !examples.iter().any(|it| it.starts_with(&input.id)) {
                examples.push(format!("{}: {place}", input.id));
            }
        }
    }
    let mut ranked: Vec<_> = by_kind.into_iter().collect();
    ranked.sort_by_key(|it| std::cmp::Reverse(it.1.0));
    for (kind, (count, examples)) in &ranked {
        println!("{count:6} {kind}");
        for example in examples {
            println!("         {example}");
        }
    }
    println!("{checked} checked, {rejected} rejected by the parser, {with_problems} with problems, {} kinds", ranked.len());
}

// ───────────────────────────── the binder without a checker ─────────────────────────────

/// The names of the side tables in which `lint`, from `bind_for_lint`, differs from `full`, from `bind`.
fn differences(full: &bun_sema::bind::Bound, lint: &bun_sema::bind::Bound) -> Vec<String> {
    use bun_sema::bind::UNREACHABLE;
    let mut different = Vec::new();
    macro_rules! same {
        ($($field:ident)*) => {$(
            if full.$field[..] != lint.$field[..] {
                let at = full.$field.iter().zip(lint.$field.iter()).position(|(a, b)| a != b);
                different.push(format!(
                    "{}: {} and {} long, first at {at:?}: {:?} and {:?}",
                    stringify!($field),
                    full.$field.len(),
                    lint.$field.len(),
                    at.map(|at| &full.$field[at]),
                    at.map(|at| &lint.$field[at]),
                ));
            }
        )*};
    }
    same! {
        ids expr_symbol expr_parent stmt_parent type_scope pat_parent pat_symbol prop_owner member_owner param_fn
        type_param_symbol type_param_scope fn_symbol class_symbol class_owner class_scope interface_symbol alias_symbol
        enum_symbol enum_member_symbol enum_member_owner module_symbol var_stmt case_stmt type_query_operands
        requires_scope_change
    }
    let mut truth = |name: &str, full: Vec<bool>, lint: Vec<bool>| {
        if full != lint {
            let at = full.iter().zip(&lint).position(|(a, b)| a != b);
            different.push(format!("{name}: {} and {} long, first at {at:?}", full.len(), lint.len()));
        }
    };
    let reached = |of: &bun_sema::bind::Bound| of.stmt_flow.iter().map(|it| *it != UNREACHABLE).collect();
    truth("stmt_flow", reached(full), reached(lint));
    let falls = |of: &bun_sema::bind::Bound| of.case_fallthrough.iter().map(|it| it.is_some()).collect();
    truth("case_fallthrough", falls(full), falls(lint));
    let ends = |of: &bun_sema::bind::Bound| of.fns.iter().map(|it| it.end != UNREACHABLE).collect();
    truth("fns.end", ends(full), ends(lint));
    let exits = |of: &bun_sema::bind::Bound| of.fns.iter().flat_map(|it| [it.exit.is_some(), it.exit != UNREACHABLE]).collect();
    truth("fns.exit", exits(full), exits(lint));
    let functions = |of: &bun_sema::bind::Bound| -> Vec<String> {
        let one = |it: &bun_sema::bind::FnInfo| {
            let lists = (it.returns.start, it.returns.len, it.yields.start, it.yields.len);
            format!("{:?} {:?} {:?} {lists:?} {}", it.owner, it.scope, it.enclosing, it.contains_this)
        };
        of.fns.iter().map(one).collect()
    };
    if functions(full) != functions(lint) {
        different.push("fns".to_owned());
    }
    let symbols = |of: &bun_sema::bind::Bound| -> Vec<String> {
        let one = |it: &bun_sema::bind::Symbol| {
            let links = (it.value_declaration, it.parent, it.export_symbol);
            format!("{:?} {:?} {:?} {links:?}", it.name, it.flags, it.decls.as_slice())
        };
        of.symbols.iter().map(one).collect()
    };
    let (all, ours) = (symbols(full), symbols(lint));
    if all != ours {
        let at = all.iter().zip(&ours).position(|(a, b)| a != b);
        let (a, b) = (at.map(|at| &all[at]), at.map(|at| &ours[at]));
        different.push(format!("symbols: {} and {}, first at {at:?}: {a:?} and {b:?}", all.len(), ours.len()));
    }
    let refused = |of: &bun_sema::bind::Bound| -> Vec<String> {
        of.redeclarations.iter().map(|it| format!("{:?} {} {:?} {}", it.symbol, it.count, it.decl, it.code)).collect()
    };
    if refused(full) != refused(lint) {
        different.push("redeclarations".to_owned());
    }
    if full.ran_out_of_stack != lint.ran_out_of_stack {
        different.push("ran_out_of_stack".to_owned());
    }
    different
}

/// What is wrong with the tables that only `bind_for_lint` has.
fn problems_of_lint_tables(hir: &bun_sema::hir::File, full: &bun_sema::bind::Bound, lint: &bun_sema::bind::Bound) -> Vec<String> {
    use bun_sema::bind::{Decl, NOT_REACHED, Parent, ScopeKind, ScopeNode};
    use bun_sema::hir::{Chain, ExprKind};
    let mut problems = Vec::new();
    let mut counts = vec![0u32; 2 * ExprTag::COUNT];
    if lint.expr_kinds.len() != hir.exprs.len() || lint.ident_scope.len() != hir.exprs.len() {
        return vec!["expr_kinds: or ident_scope: not as long as the expressions".to_owned()];
    }
    for (i, e) in hir.exprs.iter().enumerate() {
        let is_reached = lint.expr_parent[i] != Parent::None && !matches!(e.kind, ExprKind::Missing);
        let chain = match e.kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
            ExprKind::Call(call) => hir.calls[call.idx()].chain,
            _ => Chain::No,
        };
        let expected = match is_reached {
            true => 2 * e.kind.tag() as u8 + u8::from(chain != Chain::No),
            false => NOT_REACHED,
        };
        if is_reached {
            counts[expected as usize] += 1;
        }
        if lint.expr_kinds[i] != expected {
            problems.push(format!("expr_kinds: at {i}: {} and not {expected}, {:?}", lint.expr_kinds[i], e.kind));
        }
        if lint.ident_scope[i].is_some() != (is_reached && matches!(e.kind, ExprKind::Ident(_))) {
            problems.push(format!("ident_scope of what is no identifier, or none: at {i}: {:?}", e.kind));
        }
    }
    if lint.expr_kind_counts[..] != counts[..] {
        problems.push("expr_kind_counts".to_owned());
    }
    // What `bind` says of the names that it leaves to the checker.
    for &(e, scope) in full.free_idents.iter().chain(full.alias_idents.iter()) {
        if lint.ident_scope[e.idx()] != scope {
            problems.push(format!("ident_scope is another: of {e:?}: {:?} and not {scope:?}", lint.ident_scope[e.idx()]));
        }
    }
    let mut times: HashMap<Decl, u32> = HashMap::new();
    for &(symbol, decl, scope) in lint.declared.iter() {
        *times.entry(decl).or_insert(0) += 1;
        if !lint.symbols.get(symbol.idx()).is_some_and(|it| it.decls.as_slice().contains(&decl)) {
            problems.push(format!("declared: not a declaration of the symbol: {decl:?}"));
        }
        if scope.idx() >= lint.scopes.len() {
            problems.push(format!("declared: in no scope: {decl:?}"));
        }
    }
    for (decl, times) in times.iter().filter(|it| *it.1 > 1) {
        let name: String = format!("{decl:?}").chars().take_while(|c| c.is_alphabetic()).collect();
        problems.push(format!("declared {times} times, a {name}: {decl:?}"));
    }
    // What `semantic` makes variables of.
    for decl in lint.symbols.iter().flat_map(|it| it.decls.as_slice()) {
        let is_of_a_variable = matches!(
            decl,
            Decl::Var(_) | Decl::Param(_) | Decl::Require(_) | Decl::Fn(_) | Decl::Class(_) | Decl::Interface(_)
                | Decl::Alias(_) | Decl::Enum(_) | Decl::EnumMember(_) | Decl::Module(_) | Decl::TypeParam(_)
                | Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) | Decl::ImportEquals(_)
        );
        // Its symbol is in no table.
        let has_no_name = match *decl {
            Decl::Class(class) => hir.classes[class.idx()].name.is_none(),
            Decl::Fn(func) => hir.fns[func.idx()].name.is_none(),
            Decl::Module(module) => {
                let module = &hir.modules[module.idx()];
                matches!(module.name, bun_sema::hir::ModuleName::String(_))
                    || module.flags.contains(bun_sema::hir::Flags::CLASS_ELEMENT)
            }
            _ => false,
        };
        if is_of_a_variable && !has_no_name && !times.contains_key(decl) {
            let name: String = format!("{decl:?}").chars().take_while(|c| c.is_alphabetic()).collect();
            problems.push(format!("declared lacks a {name}: {decl:?}"));
        }
    }
    if lint.scope_node.len() != lint.scopes.len() {
        problems.push("scope_node: not as long as the scopes".to_owned());
    }
    for (scope, node) in lint.scopes.iter().zip(lint.scope_node.iter()) {
        if matches!(scope.kind, ScopeKind::Block | ScopeKind::TypeParams) != (*node != ScopeNode::None) {
            problems.push(format!("scope_node: {node:?} of a {:?}", scope.kind));
        }
    }
    if !full.expr_kinds.is_empty() || !full.ident_scope.is_empty() || !full.declared.is_empty() || !full.scope_node.is_empty() {
        problems.push("bind has what is for a linter".to_owned());
    }
    problems
}

/// The same for `ours`, from `bind_for_format`: of the nodes that `bind` reaches.
fn differences_for_format(full: &bun_sema::bind::Bound, ours: &bun_sema::bind::Bound) -> Vec<String> {
    use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner, Parent, PatParent};
    use bun_sema::hir::{ExprId, StmtId};
    let mut different = Vec::new();
    macro_rules! same {
        ($($field:ident unless $is_left_out:expr;)*) => {$(
            let is_left_out = $is_left_out;
            let both = full.$field.iter().zip(ours.$field.iter()).enumerate();
            let at = both.filter(|(i, (a, _))| !is_left_out(*i, *a)).find(|(_, (a, b))| a != b);
            if full.$field.len() != ours.$field.len() || at.is_some() {
                different.push(format!("{}: {} and {} long, first {at:?}", stringify!($field), full.$field.len(), ours.$field.len()));
            }
        )*};
    }
    let is_operand = |of: &bun_sema::bind::Bound, e: ExprId| of.type_query_operands.binary_search(&e).is_ok();
    same! {
        // The parent of the `a.b` of `typeof a.b` is what the type is in.
        expr_parent unless |i: usize, it: &Parent| match it {
            Parent::None => true,
            Parent::Expr(_) => false,
            _ => is_operand(full, ExprId(i as u32)),
        };
        stmt_parent unless |_, it: &Parent| *it == Parent::None;
        pat_parent unless |_, it: &PatParent| *it == PatParent::None;
        prop_owner unless |_, it: &ExprId| it.is_none();
        member_owner unless |_, it: &MemberOwner| *it == MemberOwner::None;
        param_fn unless |_, it: &bun_sema::hir::FnId| it.is_none();
        var_stmt unless |_, it: &StmtId| it.is_none();
        case_stmt unless |_, it: &StmtId| it.is_none();
        enum_member_owner unless |_, it: &bun_sema::hir::EnumId| it.is_none();
        class_owner unless |_, it: &ClassOwner| *it == ClassOwner::Stmt(StmtId::NONE);
    }
    let owners = full.fns.iter().zip(ours.fns.iter()).position(|(a, b)| a.owner != FnOwner::None && a.owner != b.owner);
    if full.fns.len() != ours.fns.len() || owners.is_some() {
        different.push(format!("fns.owner: {} and {} long, first at {owners:?}", full.fns.len(), ours.fns.len()));
    }
    let reached = (0..full.expr_parent.len()).filter(|&i| full.expr_parent[i] != Parent::None).map(|i| ExprId(i as u32));
    if let Some(e) = reached.into_iter().find(|&e| is_operand(full, e) != is_operand(ours, e)) {
        different.push(format!("type_query_operands: {e:?}"));
    }
    different
}

/// The tables in which `recycled`, which is in lists that the file before has used, is not `copied`, from the same binder.
fn differences_of_recycled<A: bun_sema::hir::Storage, B: bun_sema::hir::Storage>(
    copied: &bun_sema::bind::BoundIn<A>,
    recycled: &bun_sema::bind::BoundIn<B>,
) -> Vec<String> {
    let mut different = Vec::new();
    macro_rules! same {
        ($($field:ident)*) => {$(
            if copied.$field[..] != recycled.$field[..] {
                different.push(format!("recycled {}: {} and {} long", stringify!($field), copied.$field.len(), recycled.$field.len()));
            }
        )*};
    }
    same! {
        ids expr_symbol expr_parent stmt_parent type_scope pat_parent pat_symbol prop_owner member_owner param_fn
        type_param_symbol type_param_scope fn_symbol class_symbol class_owner class_scope interface_symbol alias_symbol
        enum_symbol enum_member_symbol enum_member_owner module_symbol var_stmt case_stmt type_query_operands
        requires_scope_change stmt_flow case_fallthrough expr_kinds expr_kind_counts ident_scope declared scope_node
    }
    fn functions<S: bun_sema::hir::Storage>(of: &bun_sema::bind::BoundIn<S>) -> Vec<String> {
        let one = |it: &bun_sema::bind::FnInfo| {
            let lists = (it.returns.start, it.returns.len, it.yields.start, it.yields.len);
            format!("{:?} {:?} {:?} {lists:?} {} {:?} {:?}", it.owner, it.scope, it.enclosing, it.contains_this, it.end, it.exit)
        };
        of.fns.iter().map(one).collect()
    }
    fn symbols<S: bun_sema::hir::Storage>(of: &bun_sema::bind::BoundIn<S>) -> Vec<String> {
        let one = |it: &bun_sema::bind::SymbolIn<S>| {
            let links = (it.value_declaration, it.parent, it.export_symbol);
            format!("{:?} {:?} {:?} {links:?}", it.name, it.flags, it.decls.as_slice())
        };
        of.symbols.iter().map(one).collect()
    }
    fn refused<S: bun_sema::hir::Storage>(of: &bun_sema::bind::BoundIn<S>) -> Vec<String> {
        of.redeclarations.iter().map(|it| format!("{:?} {} {:?} {}", it.symbol, it.count, it.decl, it.code)).collect()
    }
    if functions(copied) != functions(recycled) {
        different.push("recycled fns".to_owned());
    }
    if symbols(copied) != symbols(recycled) {
        different.push("recycled symbols".to_owned());
    }
    if refused(copied) != refused(recycled) {
        different.push("recycled redeclarations".to_owned());
    }
    if copied.scopes.len() != recycled.scopes.len() || copied.ran_out_of_stack != recycled.ran_out_of_stack {
        different.push("recycled scopes, or ran_out_of_stack".to_owned());
    }
    different
}

fn bind_check(path: &str, language: &LanguageOptions, is_for_format: bool) {
    use bun_sema::bind::{BindOptions, Recycled, bind, bind_for_format, bind_for_format_in, bind_for_lint, bind_for_lint_in};
    std::panic::set_hook(Box::new(|_| {}));
    let inputs = read_inputs(path);
    let (mut same, mut by_kind) = (0, BTreeMap::<String, (usize, Vec<String>)>::new());
    // How many inputs have expressions, statements, functions or classes that `bind` does not get to.
    let left_behind = std::cell::Cell::new([0usize; 4]);
    for input in &inputs {
        let language = LanguageOptions {
            parser: language.parser,
            source_type: input.source_type,
            jsx: language.parser == Parser::Espree,
            ..LanguageOptions::default()
        };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let session = bun_sema::session::Session::new();
            let atoms = bun_sema::atom::Interner::new_in(&session);
            let arena = session.arena();
            let how = language.parse_options(input.filename.as_bytes());
            let mut hir = bun_js_parser::sema::summarize_as(
                how.dialect,
                arena,
                input.filename.as_bytes(),
                how.script_kind,
                &input.code,
                &atoms,
                how.experimental_decorators,
                how.every_file_is_a_module,
            )
            .0;
            hir.text = input.code.clone().into();
            let options = BindOptions {
                emit_standard_class_fields: true,
                before_es2020: false,
                before_es2017: false,
            };
            let full = bind(&hir, options, &atoms, arena);
            let mut counts = left_behind.get();
            let has = [
                full.expr_parent.iter().any(|it| *it == bun_sema::bind::Parent::None),
                full.stmt_parent.iter().any(|it| *it == bun_sema::bind::Parent::None),
                full.fns.iter().any(|it| it.owner == bun_sema::bind::FnOwner::None),
                full.class_scope.iter().any(|it| it.is_none()),
            ];
            (0..4).for_each(|i| counts[i] += usize::from(has[i]));
            left_behind.set(counts);
            match is_for_format {
                true => {
                    let ours = bind_for_format(&hir, options, &atoms, arena);
                    let mut different = differences_for_format(&full, &ours);
                    let mut recycled = Recycled::of_this_thread();
                    different.extend(differences_of_recycled(&ours, bind_for_format_in(&hir, options, &atoms, &mut recycled)));
                    different
                }
                false => {
                    let lint = bind_for_lint(&hir, options, &atoms, arena);
                    let mut different = differences(&full, &lint);
                    different.extend(problems_of_lint_tables(&hir, &full, &lint));
                    let mut recycled = Recycled::of_this_thread();
                    different.extend(differences_of_recycled(&lint, bind_for_lint_in(&hir, options, &atoms, &mut recycled)));
                    different
                }
            }
        }));
        let different = outcome.unwrap_or_else(|_| vec!["panic".to_owned()]);
        same += usize::from(different.is_empty());
        for it in different {
            let name = it.split(':').next().unwrap_or_default().to_owned();
            let (count, examples) = by_kind.entry(name).or_default();
            *count += 1;
            if examples.len() < 3 {
                examples.push(format!("{}: {it}", input.id));
            }
        }
    }
    for (name, (count, examples)) in &by_kind {
        println!("{count:6} {name}");
        examples.iter().for_each(|it| println!("         {it}"));
    }
    let [exprs, stmts, fns, classes] = left_behind.get();
    println!("not reached by bind: expressions in {exprs} inputs, statements in {stmts}, functions in {fns}, classes in {classes}");
    println!("{} inputs, {same} the same, {} tables differ", inputs.len(), by_kind.len());
}

// ───────────────────────────── timing ─────────────────────────────

fn bench(path: &str) {
    struct Count(usize, u64);
    impl<'a> Visitor<'a> for Count {
        fn enter(&mut self, node: Node<'a>) {
            self.0 += 1;
            self.1 += u64::from(node.span().start);
        }
        fn exit(&mut self, _: Node<'a>) {}
    }
    let code = std::fs::read(path).expect("the file");
    let time = |name: &str, run: &mut dyn FnMut() -> usize| {
        let start = std::time::Instant::now();
        let mut result = 0;
        for _ in 0..20 {
            result = run();
        }
        println!("{name}: {:?} ({result})", start.elapsed() / 20);
    };
    time("parse and bind", &mut || {
        crate::with_file(path, &code, &LanguageOptions::default(), |file| file.body().len())
    });
    crate::with_file(path, &code, &LanguageOptions::default(), |file| {
        time("walk", &mut || {
            let mut count = Count(0, 0);
            walk(file, &mut count);
            count.0
        });
        time("walk and parent", &mut || {
            struct Parents(usize);
            impl<'a> Visitor<'a> for Parents {
                fn enter(&mut self, node: Node<'a>) {
                    self.0 += usize::from(matches!(node.parent(), Node::Expr(_)));
                }
                fn exit(&mut self, _: Node<'a>) {}
            }
            let mut count = Parents(0);
            walk(file, &mut count);
            count.0
        });
        struct Collect<'a>(Vec<Node<'a>>);
        impl<'a> Visitor<'a> for Collect<'a> {
            fn enter(&mut self, node: Node<'a>) {
                self.0.push(node);
            }
            fn exit(&mut self, _: Node<'a>) {}
        }
        let mut nodes = Collect(Vec::new());
        walk(file, &mut nodes);
        let nodes = nodes.0;
        time("span of each", &mut || nodes.iter().map(|it| it.span().end as usize).sum());
        time("parent of each", &mut || nodes.iter().filter(|it| matches!(it.parent(), Node::Expr(_))).count());
        time("kind of each expression", &mut || {
            let kinds = nodes.iter().filter_map(|it| it.as_expr()).map(|it| it.kind());
            kinds.filter(|it| matches!(it, ExprKind::Call(_) | ExprKind::String(_))).count()
        });
        time("outer_span of each expression", &mut || {
            nodes.iter().filter_map(|it| it.as_expr()).map(|it| it.outer_span().end as usize).sum()
        });
        time("children of each", &mut || {
            let mut count = 0;
            nodes.iter().for_each(|it| it.for_each_child(|_| count += 1));
            count
        });
        time("virtual walk", &mut || {
            let (mut count, mut pending) = (0, vec![VNode::program(file)]);
            while let Some(v) = pending.pop() {
                count += 1;
                v.for_each_child(|child| pending.push(child));
            }
            count
        });
        time("estree json", &mut || {
            let mut out = Vec::new();
            estree_json::write_json(file, &mut out);
            out.len()
        });
    });
}
