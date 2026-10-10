//! `bun-lint code-path ..`
//!
//! - `dot <file>`: the graph of each code path of the file, as `makeDotArrows` of ESLint's
//!   `debug-helpers.js` prints it, in the order in which the code paths end.
//! - `fixtures <directory>`: compares that with the `/*expected */` comments of each file of
//!   ESLint's `tests/fixtures/code-path-analysis`.
//! - `trace <file> [all|statements|nothing]`: every event of the analysis in order, among the nodes
//!   that are entered and left, and the graph of each code path when it ends.
//! - `batch <file> [all|statements|nothing]`: the same for each `{ "path", "code" }` of a file of JSON lines, as JSON lines.
//!   `test/cli/lint/oracle/code_path/trace.ts` compares it with what ESLint does.
//! - `reach <file>`: for each `{ "path", "code" }` of a file of JSON lines, where `Stmt::is_reachable`
//!   and the like differ from what the analysis finds. `reach.ts` runs it.
//! - `upstream`: the cases of ESLint's `tests/lib/linter/code-path-analysis/code-path.js`.
//! - `bench <file>`: how long the analysis takes.

use crate::host::{self, output, output_line};
use bun_lint::code_path::{Event, Method, Step, reachability, steps};
use bun_lint::prelude::*;
use std::fmt::Write as _;

/// What `say` has to say about each event of the analysis of a file.
fn of_events(path: &str, code: &[u8], say: impl Fn(Event) -> Option<String>) -> Vec<String> {
    crate::with_file(path, code, &LanguageOptions::default(), |file| {
        let events = steps(file, NodeTags::EMPTY, NodeTags::EMPTY).filter_map(|it| match it {
            Step::Event(event) => say(event),
            Step::Enter(_) | Step::Exit(_) => None,
        });
        events.collect()
    })
}

/// `makeDotArrows`
fn make_dot_arrows(path: CodePath) -> String {
    let initial = path.initial_segment();
    let mut stack = std::collections::VecDeque::from([(initial, 0)]);
    let mut done = rustc_hash::FxHashSet::default();
    let mut last = Some(initial);
    let mut text = format!("initial->{initial}");
    while let Some((segment, index)) = stack.pop_back() {
        if done.contains(&segment) && index == 0 {
            continue;
        }
        done.insert(segment);
        let Some(&next) = segment.all_next_segments().get(index) else {
            continue;
        };
        let _ = match last == Some(segment) {
            true => write!(text, "->{next}"),
            false => write!(text, ";\n{segment}->{next}"),
        };
        last = Some(next);
        stack.push_front((segment, index + 1));
        stack.push_back((next, 0));
    }
    for (segments, name) in [
        (path.returned_segments(), "final"),
        (path.thrown_segments(), "thrown"),
    ] {
        for segment in segments {
            let _ = match last == Some(segment) {
                true => write!(text, "->{name}"),
                false => write!(text, ";\n{segment}->{name}"),
            };
            last = None;
        }
    }
    text.push(';');
    text
}

fn dot(path: &str, code: &[u8]) -> Vec<String> {
    of_events(path, code, |event| match event {
        Event::CodePathEnd(path, _) => Some(make_dot_arrows(path)),
        _ => None,
    })
}

fn expected_dot_arrows(source: &str) -> Vec<String> {
    let mut expected = Vec::new();
    let mut rest = source;
    while let Some((_, after)) = host::split_once(rest, "/*expected") {
        let Some((arrows, after)) = host::split_once(after, "*/") else {
            break;
        };
        expected.push(host::replace(arrows.trim(), "\r\n", "\n"));
        rest = after;
    }
    expected
}

fn fixtures(directory: &str) {
    assert!(std::path::Path::new(directory).is_dir(), "the directory");
    let mut paths = host::list(directory);
    paths.sort();
    let (mut passed, mut failed) = (0, 0);
    for path in paths {
        let source = host::read_text(&path).expect("the file");
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let (expected, actual) = (expected_dot_arrows(&source), dot(&name, source.as_bytes()));
        if expected == actual {
            passed += 1;
            continue;
        }
        failed += 1;
        output_line!("──── {name}\n{source}");
        for i in 0..expected.len().max(actual.len()) {
            let (expected, actual) = (expected.get(i), actual.get(i));
            if expected != actual {
                output_line!(
                    "expected:\n{}\nactual:\n{}",
                    expected.map_or("nothing", |it| it),
                    actual.map_or("nothing", |it| it)
                );
            }
        }
    }
    output_line!("{passed} passed, {failed} failed");
}

// ───────────────────────────── the trace ─────────────────────────────

/// Whether ESTree has `e` as a pattern: it is all or a part of the target of an assignment.
fn is_pattern(e: Expr) -> bool {
    let mut e = e;
    loop {
        e = match e.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, .. } => return target == e,
                ExprKind::Array(_) | ExprKind::Spread(_) => parent,
                _ => return false,
            },
            Node::Prop(prop) if prop.value() == Some(e) => match prop.parent() {
                Node::Expr(object) if !prop.is_jsx_attribute() => object,
                _ => return false,
            },
            Node::Stmt(parent) => return is_left_of_for(parent, e),
            _ => return false,
        }
    }
}

/// Whether `e` is the `left` of the `for`-`in` or `for`-`of` that `parent` is or is the head of.
fn is_left_of_for<'a>(parent: Stmt<'a>, e: Expr<'a>) -> bool {
    let is_wrapper = |left: Stmt<'a>| matches!(left.kind(), StmtKind::Expr(left) if left == e);
    let is_left = |of: Stmt<'a>| matches!(of.kind(), StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if is_wrapper(left));
    is_left(parent) || matches!(parent.parent(), Node::Stmt(of) if is_left(of))
}

/// The expression that `stmt` only wraps: it is in the head of a `for`.
fn wrapped_in_head(stmt: Stmt) -> Option<Expr> {
    let (StmtKind::Expr(e), Node::Stmt(parent)) = (stmt.kind(), stmt.parent()) else {
        return None;
    };
    let is_head = match parent.kind() {
        StmtKind::For { init, .. } => init == Some(stmt),
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left == stmt,
        _ => false,
    };
    is_head.then_some(e)
}

/// Whether `e` is all or a part of the name of a JSX element, or of a name in a type.
fn is_name(e: Expr) -> bool {
    let mut e = e;
    loop {
        e = match e.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { .. } => parent,
                ExprKind::Jsx(jsx) => return jsx.tag() == Some(e) || jsx.close_tag() == Some(e),
                _ => return false,
            },
            Node::Type(_) => return true,
            _ => return false,
        }
    }
}

type Estree = Option<(&'static str, Span)>;

fn estree_of_expr(e: Expr) -> Estree {
    let pattern_or = |pattern, otherwise| if is_pattern(e) { pattern } else { otherwise };
    let name = match e.kind() {
        ExprKind::Missing => return None,
        ExprKind::Ident(_) | ExprKind::This | ExprKind::Dot { .. } | ExprKind::String(_)
            if is_name(e) =>
        {
            return None;
        }
        // `JSXText`
        ExprKind::String(_)
            if e.jsx_container_span().is_none()
                && matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Jsx(_))) =>
        {
            return None;
        }
        ExprKind::String(_) if e.text().starts_with(b"`") => "TemplateLiteral",
        ExprKind::Ident(_) => "Identifier",
        ExprKind::PrivateIdentifier(_) => "PrivateIdentifier",
        ExprKind::This => "ThisExpression",
        ExprKind::Super => "Super",
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_) => "Literal",
        ExprKind::Template(_) => "TemplateLiteral",
        ExprKind::TaggedTemplate(_) => "TaggedTemplateExpression",
        ExprKind::Array(_) => pattern_or("ArrayPattern", "ArrayExpression"),
        ExprKind::Object(_) => pattern_or("ObjectPattern", "ObjectExpression"),
        ExprKind::Fn(func) => return estree_of_func(func),
        ExprKind::Class(_) => "ClassExpression",
        ExprKind::Dot { .. } | ExprKind::Index { .. } => "MemberExpression",
        ExprKind::Call(_) => "CallExpression",
        ExprKind::New(_) => "NewExpression",
        ExprKind::Unary { op, .. } => match op {
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => "UpdateExpression",
            _ => "UnaryExpression",
        },
        ExprKind::Binary { op, .. } => match op {
            BinOp::And | BinOp::Or | BinOp::Nullish => "LogicalExpression",
            BinOp::Comma => {
                let is_flattened = !e.is_parenthesized()
                    && matches!(e.parent(), Node::Expr(parent)
                        if matches!(parent.kind(), ExprKind::Binary { op: BinOp::Comma, left, .. } if left == e));
                if is_flattened {
                    return None;
                }
                "SequenceExpression"
            }
            _ => "BinaryExpression",
        },
        ExprKind::Assign { op: None, .. } => {
            pattern_or("AssignmentPattern", "AssignmentExpression")
        }
        ExprKind::Assign { .. } => "AssignmentExpression",
        ExprKind::Cond { .. } => "ConditionalExpression",
        // `JSXSpreadChild`
        ExprKind::Spread(_) if e.jsx_container_span().is_some() => return None,
        ExprKind::Spread(_) => pattern_or("RestElement", "SpreadElement"),
        ExprKind::Await(_) => "AwaitExpression",
        ExprKind::Yield { .. } => "YieldExpression",
        // From a JSDoc comment.
        ExprKind::As { .. } if e.file().is_javascript() => return None,
        ExprKind::As { .. } | ExprKind::AsConst(_) => match e.is_angle_bracket_assertion() {
            true => "TSTypeAssertion",
            false => "TSAsExpression",
        },
        ExprKind::Satisfies { .. } => "TSSatisfiesExpression",
        ExprKind::NonNull(_) => "TSNonNullExpression",
        ExprKind::Instantiation { .. } => "TSInstantiationExpression",
        ExprKind::Jsx(jsx) => match jsx.is_fragment() {
            true => "JSXFragment",
            false => "JSXElement",
        },
        ExprKind::ImportCall { .. } => "ImportExpression",
        ExprKind::ImportMeta | ExprKind::NewTarget => "MetaProperty",
    };
    Some((name, e.span()))
}

fn estree_of_func(func: Func) -> Estree {
    if !func.has_body() {
        return None;
    }
    match func.kind() {
        FnKind::Decl => match func.owner() {
            Node::Stmt(stmt) => Some(("FunctionDeclaration", stmt.span_without_export())),
            _ => None,
        },
        FnKind::Arrow => Some(("ArrowFunctionExpression", func.owner().span())),
        FnKind::Expr => Some(("FunctionExpression", func.owner().span())),
        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
            Some(("FunctionExpression", func.span_from_params()))
        }
        _ => None,
    }
}

fn estree_of_stmt(stmt: Stmt) -> Estree {
    let name = match stmt.kind() {
        StmtKind::Empty => "EmptyStatement",
        StmtKind::Debugger => "DebuggerStatement",
        StmtKind::Expr(_) => "ExpressionStatement",
        StmtKind::Var(_) => "VariableDeclaration",
        StmtKind::Fn(func) => return estree_of_func(func),
        StmtKind::Class(_) => "ClassDeclaration",
        StmtKind::Return(_) => "ReturnStatement",
        StmtKind::If { .. } => "IfStatement",
        StmtKind::For { .. } => "ForStatement",
        StmtKind::ForIn { .. } => "ForInStatement",
        StmtKind::ForOf { .. } => "ForOfStatement",
        StmtKind::While { .. } => "WhileStatement",
        StmtKind::DoWhile { .. } => "DoWhileStatement",
        StmtKind::Block(_) => "BlockStatement",
        StmtKind::With { .. } => "WithStatement",
        StmtKind::Switch { .. } => "SwitchStatement",
        StmtKind::Try { .. } => "TryStatement",
        StmtKind::Throw(_) => "ThrowStatement",
        StmtKind::Break(_) => "BreakStatement",
        StmtKind::Continue(_) => "ContinueStatement",
        StmtKind::Labeled { .. } => "LabeledStatement",
        StmtKind::Import(_) => "ImportDeclaration",
        StmtKind::ExportNamed(_) => "ExportNamedDeclaration",
        StmtKind::ExportStar { .. } => "ExportAllDeclaration",
        StmtKind::ExportDefault(_) => "ExportDefaultDeclaration",
        StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_) => return None,
    };
    let mut span = stmt.span_without_export();
    if name == "BlockStatement" && stmt.text().starts_with(b"finally") {
        span.start = skip_trivia(stmt.file().text(), span.start + "finally".len() as u32);
    }
    Some((name, span))
}

/// The node of ESTree that `node` is, if the trace of ESLint has it too: see `common` in
/// `trace.ts`.
fn estree_of(node: Node) -> Estree {
    match node {
        Node::File(_) => Some(("Program", Span::default())),
        Node::Expr(e) => estree_of_expr(e),
        Node::Stmt(stmt) => match wrapped_in_head(stmt) {
            Some(_) => None,
            None => estree_of_stmt(stmt),
        },
        Node::Func(func) => match func.owner() {
            Node::Member(_) => estree_of_func(func),
            _ => None,
        },
        Node::Member(member) => {
            let is_plain = matches!(member.parent(), Node::Class(_))
                && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR);
            let name = match member.kind() {
                MemberKind::Property => "PropertyDefinition",
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => "MethodDefinition",
                MemberKind::StaticBlock => "StaticBlock",
                _ => return None,
            };
            is_plain.then(|| (name, member.span()))
        }
        Node::Prop(prop) => {
            let name = match (prop.is_jsx_attribute(), prop.kind()) {
                (true, PropKind::Spread) => "JSXSpreadAttribute",
                (true, _) => "JSXAttribute",
                (false, PropKind::Spread) => match prop.parent() {
                    Node::Expr(object) if is_pattern(object) => "RestElement",
                    _ => "SpreadElement",
                },
                (false, _) => "Property",
            };
            Some((name, prop.span()))
        }
        Node::VarDecl(declaration) => match declaration.parent() {
            Node::Stmt(parent) if matches!(parent.kind(), StmtKind::Try { .. }) => None,
            _ => Some(("VariableDeclarator", declaration.span())),
        },
        Node::Case(case) => Some(("SwitchCase", case.span())),
        Node::Pat(pat) => match pat.kind() {
            PatKind::Missing => None,
            PatKind::Ident(_) => Some(("Identifier", pat.span())),
            PatKind::Object(_) => Some(("ObjectPattern", pat.span())),
            PatKind::Array(_) => Some(("ArrayPattern", pat.span())),
        },
        Node::PatProp(prop) => match prop.is_rest() {
            true => Some(("RestElement", prop.span())),
            false => Some(("Property", prop.span())),
        },
        Node::PatElem(element) => match (element.is_rest(), element.default()) {
            (true, _) => Some(("RestElement", element.span())),
            (false, Some(_)) => Some(("AssignmentPattern", element.span())),
            (false, None) => None,
        },
        Node::ImportSpec(spec) => Some(("ImportSpecifier", spec.span())),
        Node::ExportSpec(spec) => Some(("ExportSpecifier", spec.span())),
        Node::Class(_)
        | Node::Param(_)
        | Node::Type(_)
        | Node::TypeParam(_)
        | Node::EnumMember(_)
        | Node::TupleElem(_) => None,
    }
}

/// The same for the node of an event, which can be one that is not entered or left in ESTree.
fn estree_of_event(node: Node) -> Estree {
    match node {
        Node::Func(func) => estree_of_func(func),
        Node::Class(class) => estree_of(class.owner()),
        Node::Stmt(stmt) => match wrapped_in_head(stmt) {
            Some(e) => estree_of_expr(e),
            None => estree_of_stmt(stmt),
        },
        _ => estree_of(node),
    }
}

/// Whether the traces leave out `node` and everything in it, because the trees differ too much
/// there: it only concerns types.
fn is_type_syntax(node: Node) -> bool {
    match node {
        Node::Type(_) | Node::TypeParam(_) => true,
        Node::Stmt(stmt) => matches!(stmt.kind(), StmtKind::Interface(_) | StmtKind::TypeAlias(_)),
        Node::Member(member) => member.kind() == MemberKind::IndexSignature,
        // A decorator of a parameter, which ESTree has inside the pattern.
        Node::Expr(e) => matches!(e.parent(), Node::Param(param) if param.default() != Some(e)),
        _ => false,
    }
}

#[derive(Default)]
struct Log<'a> {
    lines: Vec<String>,
    /// How many of the nodes around the current one are `is_type_syntax`.
    type_depth: usize,
    /// The lines that still lack their node: that of the event is not in both traces, so the next
    /// one that is stands for it.
    incomplete: Vec<usize>,
    /// The segments of the code paths that have not ended, those of the outermost first.
    segments: Vec<Segment<'a>>,
    /// The code paths that have not ended.
    paths: Vec<CodePath<'a>>,
}

fn write_node(line: &mut String, (name, span): (&str, Span)) {
    let _ = write!(line, " {name}@{}-{}", span.start, span.end);
}

impl<'a> Log<'a> {
    fn event(&mut self, mut line: String, node: Node) {
        let is_in_type_syntax = is_type_syntax(node) || node.ancestors().any(is_type_syntax);
        match estree_of_event(node).filter(|_| !is_in_type_syntax) {
            Some(node) => write_node(&mut line, node),
            None => self.incomplete.push(self.lines.len()),
        }
        self.lines.push(line);
    }

    fn node(&mut self, prefix: &str, node: Node) {
        if let (Node::File(file), "<", Some(path)) = (node, prefix, self.paths.last())
            && file.is_end_reachable() != path.is_current_reachable()
        {
            self.lines
                .push("is_end_reachable is wrong for the file".to_owned());
        }
        // What analyzing the function alone says has to agree.
        if let (Node::Func(func), "<", Some(path)) = (node, prefix, self.paths.last())
            && func.has_body()
            && func.kind() != FnKind::StaticBlock
            && func.is_end_reachable() != path.is_current_reachable()
        {
            self.lines.push(format!(
                "is_end_reachable is wrong at {}",
                func.span().start
            ));
        }
        if is_type_syntax(node) {
            match prefix {
                ">" => self.type_depth += 1,
                _ => self.type_depth -= 1,
            }
            return;
        }
        let Some(node) = estree_of(node).filter(|_| self.type_depth == 0) else {
            return;
        };
        for at in self.incomplete.drain(..) {
            write_node(&mut self.lines[at], node);
        }
        let mut line = prefix.to_owned();
        write_node(&mut line, node);
        self.lines.push(line);
    }

    fn tell(&mut self, event: Event<'a>) {
        match event {
            Event::CodePathStart(path, node) => {
                self.paths.push(path);
                self.event(format!("path+ {path}"), node);
            }
            Event::CodePathEnd(path, node) => {
                self.paths.pop();
                self.graph(path);
                self.event(format!("path- {path}"), node);
            }
            Event::SegmentStart(segment, node) => self.segment("seg+", segment, node),
            Event::SegmentEnd(segment, node) => self.segment("seg-", segment, node),
            Event::UnreachableSegmentStart(segment, node) => self.segment("useg+", segment, node),
            Event::UnreachableSegmentEnd(segment, node) => self.segment("useg-", segment, node),
            Event::SegmentLoop(from, to, node) => {
                self.event(format!("loop {from} {to}"), node);
                let order = traverse(from.code_path(), Some(to), Some(from), None, None);
                let names: Vec<String> = order.iter().map(Segment::to_string).collect();
                self.lines.push(format!("  traverse {}", names.join(",")));
            }
        }
    }

    fn segment(&mut self, prefix: &str, segment: Segment<'a>, node: Node) {
        self.segments.push(segment);
        self.event(format!("{prefix} {segment}"), node);
    }

    /// Everything that can be told about `path` and about each of its segments that an event has
    /// named or that another leads to.
    fn graph(&mut self, path: CodePath<'a>) {
        let list = |segments: &[Segment]| {
            let names: Vec<String> = segments.iter().map(Segment::to_string).collect();
            names.join(",")
        };
        self.lines.push(format!(
            "graph {path} origin={:?} upper={} initial={} final={} returned={} thrown={}",
            path.origin(),
            path.upper()
                .map_or_else(|| "none".to_owned(), |it| it.to_string()),
            path.initial_segment(),
            list(&path.final_segments()),
            list(&path.returned_segments()),
            list(&path.thrown_segments()),
        ));
        let mut found: Vec<Segment> = vec![path.initial_segment()];
        found.extend(self.segments.iter().filter(|it| it.code_path() == path));
        self.segments.retain(|it| it.code_path() != path);
        found.extend(path.final_segments());
        let mut seen: rustc_hash::FxHashSet<Segment> = found.iter().copied().collect();
        found.retain({
            let mut first = rustc_hash::FxHashSet::default();
            move |it| first.insert(*it)
        });
        let mut at = 0;
        while let Some(&segment) = found.get(at) {
            at += 1;
            for other in segment
                .all_next_segments()
                .into_iter()
                .chain(segment.all_prev_segments())
            {
                if seen.insert(other) {
                    found.push(other);
                }
            }
        }
        found.sort_by_key(|it| it.id());
        for segment in found {
            self.lines.push(format!(
                "  {segment} reachable={} next={} prev={} allNext={} allPrev={}",
                segment.is_reachable(),
                list(&segment.next_segments()),
                list(&segment.prev_segments()),
                list(&segment.all_next_segments()),
                list(&segment.all_prev_segments()),
            ));
        }
        // `traverseSegments`, plain and with some of what can be asked of it.
        let order = traverse(path, None, None, None, None);
        self.lines.push(format!("  traverse {}", list(&order)));
        for (i, &at) in order.iter().enumerate().take(6) {
            self.lines.push(format!(
                "  traverse skip={at} {}",
                list(&traverse(path, None, None, Some(at), None))
            ));
            self.lines.push(format!(
                "  traverse break={at} {}",
                list(&traverse(path, None, None, None, Some(at)))
            ));
            for &last in order.iter().skip(i).take(3) {
                let order = traverse(path, Some(at), Some(last), None, None);
                self.lines.push(format!(
                    "  traverse first={at} last={last} {}",
                    list(&order)
                ));
            }
        }
    }
}

/// The segments in the order in which `traverse_segments_between` visits them, if the callback
/// skips at `skip` and stops at `stop`.
fn traverse<'a>(
    path: CodePath<'a>,
    first: Option<Segment<'a>>,
    last: Option<Segment<'a>>,
    skip: Option<Segment<'a>>,
    stop: Option<Segment<'a>>,
) -> Vec<Segment<'a>> {
    let mut order = Vec::new();
    path.traverse_segments_between(first, last, |segment, traversal| {
        order.push(segment);
        if skip == Some(segment) {
            traversal.skip();
        }
        if stop == Some(segment) {
            traversal.stop();
        }
    });
    order
}

/// The trace of a file. `listen`: which nodes are in it.
/// - `all`: all that both trees have.
/// - `statements`, `nothing`: only those, or only the file. The analysis leaves out what nobody
///   listens for and does not matter to it, which must not change anything else.
fn trace(path: &str, code: &[u8], listen: &str) -> Vec<String> {
    let listened = match listen {
        "all" => NodeTags::ALL,
        "statements" => StmtTag::ALL
            .iter()
            .fold(NodeTags::FILE, |all, &tag| all | tag.into()),
        _ => NodeTags::FILE,
    };
    crate::with_file(path, code, &LanguageOptions::default(), |file| {
        let mut log = Log::default();
        for step in steps(file, listened, listened) {
            match step {
                Step::Enter(node) => log.node(">", node),
                Step::Exit(node) => log.node("<", node),
                Step::Event(event) => log.tell(event),
            }
        }
        log.lines
    })
}

fn batch(path: &str, listen: &str) {
    let input = host::read(path).expect("the file");
    let mut output = String::new();
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        let case = bun_lint::json::parse(line).expect("JSON");
        let path = case.get(b"path").and_then(Json::as_str).unwrap_or_default();
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = host::text(path);
        let has_errors = crate::with_file(&path, code, &LanguageOptions::default(), |file| {
            file.has_parse_errors()
        });
        let trace = match has_errors {
            true => Vec::new(),
            false => trace(&path, code, listen),
        };
        let _ = writeln!(
            output,
            "{{\"errors\":{has_errors},\"trace\":[\"{}\"]}}",
            trace.join("\",\"")
        );
    }
    output!("{output}");
}

/// For each `{ "path", "code" }` of a file of JSON lines, where what is found out from the
/// statements alone differs from what the analysis finds.
fn compare_reachability(path: &str) {
    let input = host::read(path).expect("the file");
    let mut output = String::new();
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        let case = bun_lint::json::parse(line).expect("JSON");
        let path = case.get(b"path").and_then(Json::as_str).unwrap_or_default();
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = host::text(path);
        let differences = crate::with_file(&path, code, &LanguageOptions::default(), |file| {
            if file.has_parse_errors() {
                return Vec::new();
            }
            let (quick, analysis) = (
                reachability(file, Method::Quick),
                reachability(file, Method::Analysis),
            );
            let mut differences = Vec::new();
            fn compare<T: PartialEq + Copy>(
                what: &str,
                a: &[T],
                b: &[T],
                at: impl Fn(T) -> u32,
                to: &mut Vec<String>,
            ) {
                to.extend(
                    a.iter()
                        .filter(|it| !b.contains(it))
                        .map(|&it| format!("{what} only quick {}", at(it))),
                );
                to.extend(
                    b.iter()
                        .filter(|it| !a.contains(it))
                        .map(|&it| format!("{what} only analysis {}", at(it))),
                );
            }
            compare(
                "unreachable",
                &quick.0,
                &analysis.0,
                |it| it.span().start,
                &mut differences,
            );
            compare(
                "case-end",
                &quick.1,
                &analysis.1,
                |it| it.span().start,
                &mut differences,
            );
            compare(
                "fn-end",
                &quick.2,
                &analysis.2,
                |it| it.span().start,
                &mut differences,
            );
            if quick.3 != analysis.3 {
                differences.push("file-end differs 0".to_owned());
            }
            compare(
                "repeating",
                &quick.4,
                &analysis.4,
                |it| it.span().start,
                &mut differences,
            );
            differences
        });
        let _ = writeln!(output, "[\"{}\"]", differences.join("\",\""));
    }
    output!("{output}");
}

// ───────────────────────────── ESLint's tests of `CodePath` ─────────────────────────────

/// What a case of `tests/lib/linter/code-path-analysis/code-path.js` asks of `traverseSegments`.
#[derive(Copy, Clone)]
enum Ask {
    Plain,
    /// From the first of the segments after the initial one to the second of those after that.
    FirstAndLast,
    Break(&'static str),
    Skip(&'static str),
}

const NESTED_IFS: &str = "if (a) { if (b) { foo(); } bar(); } else { out1(); } out2();";

const TRAVERSALS: &[(&str, Ask, &str)] = &[
    ("foo(); bar(); baz();", Ask::Plain, "s1_1"),
    (
        "if (a) foo(); else bar(); baz();",
        Ask::Plain,
        "s1_1,s1_2,s1_3,s1_4",
    ),
    (
        "switch (a) { case 0: foo(); break; case 1: bar(); } baz();",
        Ask::Plain,
        "s1_1,s1_2,s1_4,s1_5,s1_6",
    ),
    ("while (a) foo(); bar();", Ask::Plain, "s1_1,s1_2,s1_3,s1_4"),
    (
        "for (var i = 0; i < 10; ++i) foo(i); bar();",
        Ask::Plain,
        "s1_1,s1_2,s1_3,s1_4,s1_5",
    ),
    (
        "for (var key in obj) foo(key); bar();",
        Ask::Plain,
        "s1_1,s1_3,s1_2,s1_4,s1_5",
    ),
    (
        "try { foo(); } catch (e) { bar(); } baz();",
        Ask::Plain,
        "s1_1,s1_2,s1_3,s1_4",
    ),
    (NESTED_IFS, Ask::FirstAndLast, "s1_2,s1_3,s1_4"),
    (NESTED_IFS, Ask::Break("s1_2"), "s1_1,s1_2"),
    (NESTED_IFS, Ask::Skip("s1_2"), "s1_1,s1_2,s1_5,s1_6"),
    (
        "if (a) { if (b) { foo(); } bar(); } out1();",
        Ask::Skip("s1_4"),
        "s1_1,s1_2,s1_3,s1_4,s1_5",
    ),
    ("a; while (b) { c; }", Ask::Skip("s1_1"), "s1_1"),
];

const ORIGINS: &[(&str, usize, Origin)] = &[
    ("foo(); bar(); baz();", 0, Origin::Program),
    ("function foo() {}", 1, Origin::Function),
    ("let foo = () => {}", 1, Origin::Function),
    ("class Foo { a=1; }", 1, Origin::ClassFieldInitializer),
    (
        "class Foo { static { this.a=1; } }",
        1,
        Origin::ClassStaticBlock,
    ),
];

thread_local! {
    static ASK: std::cell::Cell<Ask> = const { std::cell::Cell::new(Ask::Plain) };
}

/// The origin of each code path, and the order of the traversal `ASK` of the first.
fn origins_and_orders(code: &[u8]) -> Vec<String> {
    of_events("file.js", code, |event| {
        let Event::CodePathStart(path, _) = event else {
            return None;
        };
        let mut order = Vec::new();
        let (mut first, mut last) = (None, None);
        if let Ask::FirstAndLast = ASK.get() {
            first = path.initial_segment().next_segments().first().copied();
            last = first.and_then(|it| it.next_segments().get(1).copied());
        }
        path.traverse_segments_between(first, last, |segment, traversal| {
            order.push(segment.to_string());
            match ASK.get() {
                Ask::Break(at) if order.last().is_some_and(|it| it == at) => traversal.stop(),
                Ask::Skip(at) if order.last().is_some_and(|it| it == at) => traversal.skip(),
                _ => {}
            }
        });
        Some(format!("{:?} {}", path.origin(), order.join(",")))
    })
}

fn upstream() {
    let mut failed = 0;
    for &(code, ask, expected) in TRAVERSALS {
        ASK.set(ask);
        let said = origins_and_orders(code.as_bytes());
        let actual = said
            .first()
            .and_then(|it| host::split_once(it, " "))
            .map_or("", |it| it.1);
        if actual != expected {
            failed += 1;
            output_line!("{code}\n  expected {expected}\n  actual   {actual}");
        }
    }
    ASK.set(Ask::Plain);
    for &(code, path, expected) in ORIGINS {
        let said = origins_and_orders(code.as_bytes());
        let actual = said
            .get(path)
            .and_then(|it| host::split_once(it, " "))
            .map_or("", |it| it.0);
        if actual != format!("{expected:?}") {
            failed += 1;
            output_line!("{code}\n  expected {expected:?}\n  actual   {actual}");
        }
    }
    output_line!(
        "{} passed, {failed} failed",
        TRAVERSALS.len() + ORIGINS.len() - failed
    );
}

/// The shortest of some runs.
fn time(mut run: impl FnMut()) -> std::time::Duration {
    let once = |run: &mut dyn FnMut()| {
        let start = std::time::Instant::now();
        run();
        start.elapsed()
    };
    (0..30).map(|_| once(&mut run)).min().unwrap_or_default()
}

/// How long the analysis of a file takes, next to parsing and binding it.
fn bench(path: &str) {
    let code = host::read(path).expect("the file");
    let language = LanguageOptions::default();
    let parsing = time(|| {
        crate::with_file(path, &code, &language, |file| file.has_parse_errors());
    });
    crate::with_file(path, &code, &language, |file| {
        struct Nothing;
        impl<'a> bun_lint::ast::walk::Visitor<'a> for Nothing {
            fn enter(&mut self, _: Node<'a>) {}
            fn exit(&mut self, _: Node<'a>) {}
        }
        let walk = time(|| bun_lint::ast::walk::walk(file, &mut Nothing));
        let statements = StmtTag::ALL
            .iter()
            .fold(NodeTags::FILE, |all, &tag| all | tag.into());
        let analysis = time(|| {
            steps(file, NodeTags::EMPTY, NodeTags::EMPTY).count();
        });
        let with_statements = time(|| {
            steps(file, statements, statements).count();
        });
        let reach = time(|| {
            reachability(file, Method::Quick);
        });
        let with_everything = time(|| {
            steps(file, NodeTags::ALL, NodeTags::ALL).count();
        });
        output_line!(
            "{} bytes, {} events: parse and bind {parsing:?}, reachability of all statements {reach:?}, a walk {walk:?}, analysis {analysis:?}, and all statements {with_statements:?}, and all nodes {with_everything:?}",
            code.len(),
            steps(file, NodeTags::EMPTY, NodeTags::EMPTY).count(),
        );
    });
}

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path] if command == "dot" => {
            let code = host::read(path).expect("the file");
            output_line!("{}", dot(path, &code).join("\n\n"));
        }
        [command, directory] if command == "fixtures" => fixtures(directory),
        [command, path, listen @ ..] if command == "trace" => {
            let code = host::read(path).expect("the file");
            let listen = listen.first().map_or("all", |it| it);
            output_line!("{}", trace(path, &code, listen).join("\n"));
        }
        [command, path, listen @ ..] if command == "batch" => {
            batch(path, listen.first().map_or("all", |it| it));
        }
        [command, path] if command == "reach" => compare_reachability(path),
        [command, path] if command == "bench" => bench(path),
        [command] if command == "upstream" => upstream(),
        // For a profiler.
        [command, path, rounds] if command == "analyze" => {
            let code = host::read(path).expect("the file");
            crate::with_file(path, &code, &LanguageOptions::default(), |file| {
                for _ in 0..rounds.parse().unwrap_or(1) {
                    steps(file, NodeTags::EMPTY, NodeTags::EMPTY).count();
                }
            });
        }
        _ => output_line!(
            "usage: bun-lint code-path dot <file> | fixtures <directory> | trace <file> | batch <file> | upstream | bench <file>"
        ),
    }
}
