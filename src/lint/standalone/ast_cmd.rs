//! `bun-lint ast ..`
//!
//! - `estree <file>`: the ESTree of a file as JSON.
//! - `estree-batch <inputs.jsonl>`: the same for many. A line of the input is
//!   `{"id": .., "filename": .., "code": ..}`, a line of the output `{"id": .., "ast": ..}` or
//!   `{"id": .., "error": ..}`.
//! - `check <file>..`: whether `bun_lint::ast` is consistent with itself for these files.
//! - `check-batch <inputs.jsonl>`: the same for many, summarized by the kind of problem.
//! - `bench <file>`: how long the ways through a file take.

use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{ExprKind, ExprTag, File, Node, PatTag, StmtTag, TypeTag};
use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::options::{Json, Options};
use bun_lint::rule::{Kind, Listeners, Meta, Rule};
use bun_lint::runner::Enabled;
use std::collections::{BTreeMap, HashMap};
use std::io::Write as _;
use std::sync::Mutex;

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path] if command == "estree" => estree(path),
        [command, path] if command == "estree-batch" => estree_batch(path),
        [command, paths @ ..] if command == "check" && !paths.is_empty() => check_files(paths),
        [command, path] if command == "check-batch" => check_batch(path),
        [command, path] if command == "bench" => bench(path),
        _ => println!("usage: bun-lint ast estree|estree-batch|check|check-batch|bench <path>"),
    }
}

// ───────────────────────────── inputs ─────────────────────────────

struct Input {
    id: String,
    filename: String,
    code: Vec<u8>,
}

fn read_inputs(path: &str) -> Vec<Input> {
    let text = std::fs::read(path).expect("the inputs");
    let lines = text.split(|b| *b == b'\n').filter(|line| !line.is_empty());
    let inputs = lines.filter_map(|line| {
        let json = bun_lint::json::parse(line)?;
        let field = |name: &[u8]| json.get(name).and_then(Json::as_str).map(<[u8]>::to_vec);
        Some(Input {
            id: String::from_utf8_lossy(&field(b"id")?).into_owned(),
            filename: String::from_utf8_lossy(&field(b"filename")?).into_owned(),
            code: field(b"code")?,
        })
    });
    inputs.collect()
}

/// Calls `then` with the file of `input`. `Err` if it panics.
fn with_input<R>(input: &Input, then: impl for<'a> FnOnce(&'a File<'a>) -> R) -> Result<R, String> {
    let language = LanguageOptions::default();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::with_file(&input.filename, &input.code, &language, then)
    }));
    outcome.map_err(|panic| match panic.downcast_ref::<String>() {
        Some(message) => message.clone(),
        None => (panic.downcast_ref::<&str>()).map_or("?".to_owned(), |it| (*it).to_owned()),
    })
}

// ───────────────────────────── ESTree ─────────────────────────────

fn estree(path: &str) {
    let code = std::fs::read(path).expect("the file");
    crate::with_file(path, &code, &LanguageOptions::default(), |file| {
        if file.has_parse_errors() {
            return println!("the parser rejects the code");
        }
        let mut out = Vec::new();
        if !bun_lint::estree::write_json(file, &mut out) {
            return println!("the syntax is nested too deeply");
        }
        out.push(b'\n');
        let _ = std::io::stdout().write_all(&out);
    });
}

fn estree_batch(path: &str) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    let mut out = Vec::new();
    for input in read_inputs(path) {
        out.clear();
        let _ = write!(out, "{{\"id\":{:?},\"ast\":", input.id);
        let prefix = out.len();
        let outcome = with_input(&input, |file| match file.has_parse_errors() {
            true => Err("parse".to_owned()),
            false if bun_lint::estree::write_json(file, &mut out) => Ok(()),
            false => Err("depth".to_owned()),
        });
        if let Err(error) = outcome.map_err(|panic| format!("panic: {panic}")).flatten() {
            out.truncate(prefix - "\"ast\":".len());
            let _ = write!(out, "\"error\":{error:?}");
        }
        out.extend_from_slice(b"}\n");
        let _ = stdout.write_all(&out);
    }
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

/// What the rule below finds.
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
        crate::with_file(path, &code, &LanguageOptions::default(), |file| {
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
        let outcome = with_input(input, |file| (!file.has_parse_errors()).then(|| check(file)));
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
        time("estree json", &mut || {
            let mut out = Vec::new();
            bun_lint::estree::write_json(file, &mut out);
            out.len()
        });
    });
}
