//! `bun-lint utils-core dump <cases.jsonl>`: what `utils::ast_utils` and `utils::estree_compat` say
//! about every node of each case, one line a case, to compare with
//! `test/cli/lint/oracle/utils-core/dump.ts`.
//!
//! A case is `{ id, filename, code, sourceType, ecmaVersion }`. A line of the output is
//! `{ "id": .., "facts": ["name|type|start|end|value", ..] }`, or `{ "id": .., "error": true }` if
//! the code does not parse. `bun-lint utils-core adjacent <pairs.jsonl>` answers
//! `can_tokens_be_adjacent` for `[left, right]` pairs, `bun-lint utils-core text <pairs.jsonl>` prints
//! what `utils::text` makes of them, `bun-lint utils-core types-at <cases.jsonl>` the
//! `estree_type_at` of every offset, as runs, `bun-lint utils-core strings <cases.jsonl>` every string.

use bstr::BStr;
use bun_lint::ast::{Expr, ExprKind, ExprTag, File, Node, Stmt, StmtKind};
use bun_lint::context::{Cx, Severity};
use bun_lint::language::{LanguageOptions, SourceType};
use bun_lint::options::{Json, Object, Options};
use bun_lint::rule::{Kind, Listeners, Message, Meta, Rule};
use bun_lint::runner::{Enabled, RuleEntry};
use bun_lint::span::Span;
use bun_lint::utils::string_literals::{
    StringLiteral, StringLiteralRole, StringLiterals, on_string_literals,
};
use bun_lint::utils::{self, Target, TargetKind, ast_utils};
use std::fmt::Write;

struct Facts<'a> {
    file: &'a File<'a>,
    out: Vec<String>,
}

impl<'a> Facts<'a> {
    fn add(&mut self, name: &str, node: Node<'a>, value: impl std::fmt::Display) {
        let span = utils::estree_span(node);
        let kind = utils::estree_type_name(node);
        self.out
            .push(format!("{name}|{kind}|{}|{}|{value}", span.start, span.end));
    }

    fn text(value: Option<impl AsRef<[u8]>>) -> String {
        match value {
            Some(value) => format!("={}", BStr::new(value.as_ref())),
            None => "null".to_owned(),
        }
    }

    fn span(span: Option<Span>) -> String {
        span.map_or("null".to_owned(), |it| format!("{}-{}", it.start, it.end))
    }

    /// The elements of a pattern, and all that it assigns to.
    fn pattern(&mut self, target: Target<'a>) {
        if !matches!(target.kind(), TargetKind::Array | TargetKind::Object) {
            return;
        }
        let start = |span: Option<Span>| span.map_or(-1, |it| i64::from(it.start));
        let mut value = String::new();
        for it in target.elements() {
            _ = write!(
                value,
                "{} {} {} {} {},",
                Self::text(it.key.and_then(ast_utils::get_static_key_name)),
                start(it.target.map(Target::span)),
                start(it.default.map(Expr::span)),
                it.is_rest,
                it.is_shorthand,
            );
        }
        value.push_str(" leaves");
        target.for_each_leaf(&mut |leaf| _ = write!(value, " {}", leaf.span().start));
        self.add("pattern", target.into(), value);
    }

    fn expr(&mut self, e: Expr<'a>) {
        let node = Node::Expr(e);
        if utils::is_assignment_target(e) {
            self.pattern(Target::Expr(e));
        }
        // What ESTree has no node for.
        if e.is_missing()
            || (matches!(e.kind(), ExprKind::Binary { .. }) && utils::sequence_root(e) != e)
        {
            return;
        }
        if matches!(e.kind(), ExprKind::Fn(_) | ExprKind::Class(_)) {
            self.add("precedence", node, ast_utils::get_precedence(e));
            self.add("parenthesised", node, ast_utils::is_parenthesised(e));
            self.add("constant", node, ast_utils::is_constant(e, false));
            self.add("callee", node, ast_utils::is_callee(e));
            return;
        }
        self.add("node", node, "");
        if utils::estree_type_name(node).starts_with("JSX") || utils::is_in_type_query(e) {
            return;
        }
        self.add("precedence", node, ast_utils::get_precedence(e));
        self.add("parenthesised", node, ast_utils::is_parenthesised(e));
        self.add(
            "parenthesisedText",
            node,
            BStr::new(ast_utils::get_parenthesised_text(e)),
        );
        self.add(
            "staticString",
            node,
            Self::text(ast_utils::get_static_string_value(e)),
        );
        self.add("constant", node, ast_utils::is_constant(e, false));
        self.add("constantBoolean", node, ast_utils::is_constant(e, true));
        self.add("couldBeError", node, ast_utils::could_be_error(e));
        self.add("callee", node, ast_utils::is_callee(e));
        self.add("inLoop", node, ast_utils::is_in_loop(e));
        self.add(
            "startOfStatement",
            node,
            ast_utils::is_start_of_expression_statement(e),
        );
        self.add("nullOrUndefined", node, ast_utils::is_null_or_undefined(e));
        self.add("decimalInteger", node, ast_utils::is_decimal_integer(e));
        self.add(
            "upperFunction",
            node,
            Self::span(ast_utils::get_upper_function(e).map(|it| utils::estree_span(it.into()))),
        );
        if ast_utils::is_literal(e) {
            self.add(
                "booleanValue",
                node,
                format!("{:?}", ast_utils::get_boolean_value(e)),
            );
        }
        if ast_utils::is_member_expression(e) {
            self.add(
                "staticProperty",
                node,
                Self::text(ast_utils::get_static_property_name(e)),
            );
            self.add("chainRoot", node, utils::is_chain_root(e));
        }
        if matches!(e.kind(), ExprKind::Call(_) | ExprKind::NonNull(_)) {
            self.add("chainRoot", node, utils::is_chain_root(e));
        }
        if e.as_ident().is_some() {
            self.add("globalReference", node, ast_utils::is_global_reference(e));
        }
        if let ExprKind::Binary { left, right, .. }
        | ExprKind::Assign {
            target: left,
            value: right,
            ..
        } = e.kind()
            && !utils::is_sequence_root(e)
        {
            self.add(
                "sameReference",
                node,
                ast_utils::is_same_reference(left, right, false),
            );
            self.add(
                "sameReferenceStrict",
                node,
                ast_utils::is_same_reference(left, right, true),
            );
            self.add(
                "equalTokens",
                node,
                ast_utils::equal_tokens(self.file, left, right),
            );
        }
        if utils::is_sequence_root(e) {
            let mut list = String::new();
            for it in utils::sequence_expressions(e) {
                _ = write!(list, "{}-{},", it.span().start, it.span().end);
            }
            self.add("sequence", node, list);
        }
        if matches!(e.parent(), Node::Stmt(parent) if utils::estree_compat::is_expression_statement(parent))
        {
            self.add(
                "needsSemicolon",
                node,
                ast_utils::needs_preceding_semicolon(e),
            );
        }
    }

    fn stmt(&mut self, statement: Stmt<'a>) {
        let node = Node::Stmt(statement);
        if matches!(statement.kind(), StmtKind::Fn(_) | StmtKind::Class(_))
            || (matches!(statement.kind(), StmtKind::Expr(_))
                && utils::estree_compat::is_for_init(statement))
        {
            return;
        }
        self.add("node", node, "");
        self.add(
            "topLevel",
            node,
            ast_utils::is_top_level_expression_statement(statement),
        );
        self.add("directive", node, ast_utils::is_directive(statement));
        self.add(
            "breakable",
            node,
            ast_utils::is_breakable_statement(statement),
        );
        self.add("emptyBlock", node, ast_utils::is_empty_block(statement));
        self.add(
            "statementListParent",
            node,
            ast_utils::is_statement_list_parent(statement.parent()),
        );
        self.add(
            "trailing",
            node,
            Self::span(
                ast_utils::get_trailing_statement(statement)
                    .map(|it| utils::estree_span(it.into())),
            ),
        );
        if statement.as_block().is_some_and(|body| body.len() == 1) {
            self.add(
                "bracesNecessary",
                node,
                ast_utils::are_braces_necessary(statement),
            );
        }
    }

    fn visit(&mut self, node: Node<'a>) {
        match node {
            Node::File(file) => {
                let count = ast_utils::get_directive_prologue(file).count();
                self.out.push(format!("prologue|Program|0|0|{count}"));
            }
            Node::Expr(e) => self.expr(e),
            Node::Stmt(statement) => self.stmt(statement),
            Node::Func(func) => {
                self.add("node", node, "");
                if ast_utils::is_function(func) {
                    self.add(
                        "name",
                        node,
                        BStr::new(&ast_utils::get_function_name_with_kind(func)),
                    );
                    self.add(
                        "head",
                        node,
                        Self::span(Some(ast_utils::get_function_head_loc(func))),
                    );
                    self.add(
                        "paren",
                        node,
                        Self::span(ast_utils::get_opening_paren_of_params(func)),
                    );
                    self.add("empty", node, ast_utils::is_empty_function(func));
                    self.add(
                        "prologue",
                        node,
                        ast_utils::get_directive_prologue(func).count(),
                    );
                    if !func.is_arrow() {
                        self.add(
                            "defaultThis",
                            node,
                            ast_utils::is_default_this_binding(func, true),
                        );
                        self.add(
                            "defaultThisNoCap",
                            node,
                            ast_utils::is_default_this_binding(func, false),
                        );
                    }
                }
            }
            Node::Prop(_) | Node::Member(_) | Node::PatProp(_) => {
                self.add("node", node, "");
                self.add(
                    "staticProperty",
                    node,
                    Self::text(ast_utils::get_static_property_name(node)),
                );
            }
            Node::Case(case) => {
                self.add("node", node, "");
                let colon = ast_utils::get_switch_case_colon_token(case);
                self.add("colon", node, Self::span(colon.map(|it| it.span())));
            }
            Node::Pat(pat) => {
                self.add("node", node, "");
                self.pattern(Target::Pat(pat));
            }
            Node::PatElem(element) if element.pat().is_none() => {}
            Node::TypeParam(param) if matches!(param.parent(), Node::Type(_)) => {}
            _ => self.add("node", node, ""),
        }
        node.for_each_child(|child| self.visit(child));
    }
}

fn json_string(text: &str, out: &mut String) {
    out.push_str(&String::from_utf8_lossy(&utils::text::json_stringify(
        text.as_bytes(),
    )));
}

fn dump(case: Object<'_>) -> String {
    let id = case.number("id").unwrap_or(-1.0);
    let language = LanguageOptions {
        source_type: match case.str("sourceType") {
            Some("script") => SourceType::Script,
            Some("commonjs") => SourceType::CommonJs,
            _ => SourceType::Module,
        },
        ecma_version: case
            .number("ecmaVersion")
            .map_or(LanguageOptions::LATEST_ECMA_VERSION, |it| it as u32),
        ..LanguageOptions::default()
    };
    let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
    crate::with_file(
        case.str("filename").unwrap_or("file.js"),
        code,
        &language,
        |file| {
            if file.has_parse_errors() {
                return format!("{{\"id\":{id},\"error\":true}}");
            }
            let mut facts = Facts {
                file,
                out: Vec::new(),
            };
            facts.visit(Node::File(file));
            for comment in facts.file.comments() {
                let span = comment.span();
                facts.out.push(format!(
                    "comment|{:?}|{}|{}|{} {}",
                    comment.kind(),
                    span.start,
                    span.end,
                    ast_utils::is_directive_comment(&comment),
                    ast_utils::matches_comments_ignore_pattern(comment.comment_value()),
                ));
            }
            let mut line = format!("{{\"id\":{id},\"facts\":[");
            for (i, fact) in facts.out.iter().enumerate() {
                if i > 0 {
                    line.push(',');
                }
                json_string(fact, &mut line);
            }
            line.push_str("]}");
            line
        },
    )
}

/// Reports every string of a file, with the type of its parent in ESTree.
struct Strings;

const STRING: Message = Message::new("string", "{{type}} {{parent}}");

impl StringLiterals for Strings {
    fn string_literal<'a>(&self, literal: StringLiteral<'a>, cx: &mut Cx<'a, Self>) {
        let kind = match literal.role {
            StringLiteralRole::TypeTemplateElement => "TemplateElement",
            _ if literal.is_template() => "TemplateLiteral",
            _ => "Literal",
        };
        cx.report(literal, STRING)
            .data("type", kind)
            .data("parent", literal.estree_parent_type());
    }
}

impl Rule for Strings {
    const META: Meta = Meta::eslint("strings", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Strings
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on_string_literals(on);
        on.exprs([ExprTag::String, ExprTag::Template], |_, e, cx| {
            let kind = utils::estree_type_name(e.into());
            let is_static = !matches!(e.kind(), ExprKind::Template(it) if !it.exprs().is_empty());
            if is_static && !kind.starts_with("JSX") {
                cx.report(e, STRING).data("type", kind).data("parent", "-");
            }
        });
    }
}

/// What `utils::text` says about `a`, and about `a` and `b`.
fn text_facts(a: &[u8], b: &[u8]) -> String {
    use utils::text;
    let number = text::string_to_number(a);
    let fields: [Vec<u8>; 18] = [
        text::utf16_len(a).to_string().into(),
        text::code_point_count(a).to_string().into(),
        text::trim(a).to_vec(),
        text::trim_start(a).to_vec(),
        text::trim_end(a).to_vec(),
        text::to_lower_case(a).into_owned(),
        text::to_upper_case(a).into_owned(),
        text::upper_case_first(a).into_owned(),
        text::escape_reg_exp(a).into_owned(),
        text::escape_string_regexp(a).into_owned(),
        text::number_to_string(number),
        text::json_stringify(a),
        text::lines(a).count().to_string().into(),
        text::utf16_slice(a, 1, 3).to_vec(),
        format!(
            "{} {}",
            text::is_identifier_es5(a),
            text::is_identifier_es6(a)
        )
        .into(),
        format!(
            "{:?} {:?}",
            text::compare(a, b),
            text::natural_compare(a, b)
        )
        .into(),
        format!(
            "{:?} {:?}",
            utils::collation::locale_compare(a, b),
            utils::collation::collator_compare_numeric_base(a, b)
        )
        .into(),
        format!(
            "{} {}",
            ast_utils::has_octal_or_non_octal_decimal_escape_sequence(a),
            ast_utils::starts_with_upper_case(a)
        )
        .into(),
    ];
    let mut line = String::from("[");
    for (i, field) in fields.iter().enumerate() {
        if i > 0 {
            line.push(',');
        }
        line.push_str(&String::from_utf8_lossy(&text::json_stringify(field)));
    }
    line.push(']');
    line
}

pub(crate) fn run(args: &[String]) {
    let (Some(mode), Some(path)) = (args.first(), args.get(1)) else {
        println!("usage: bun-lint utils-core dump <cases.jsonl> | adjacent <pairs.jsonl>");
        return;
    };
    let Ok(input) = std::fs::read(path) else {
        println!("cannot read {path}");
        return;
    };
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        let Some(json) = bun_lint::json::parse(line) else {
            continue;
        };
        match mode.as_str() {
            "adjacent" => {
                let pair = json.as_array().unwrap_or_default();
                let text = |i: usize| pair.get(i).and_then(Json::as_str).unwrap_or_default();
                println!("{}", ast_utils::can_tokens_be_adjacent(text(0), text(1)));
            }
            "types-at" => {
                let case = Object::of(Some(&json));
                let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
                let path = case.str("filename").unwrap_or("file.js");
                let id = case.number("id").unwrap_or(-1.0);
                crate::with_file(path, code, &LanguageOptions::default(), |file| {
                    if file.has_parse_errors() || !code.is_ascii() {
                        println!("{{\"id\":{id},\"error\":true}}");
                        return;
                    }
                    let mut runs = String::new();
                    let mut previous = ("", 0);
                    for offset in 0..code.len() as u32 {
                        let name = utils::estree_type_at(file, offset);
                        if name != previous.0 {
                            if previous.1 > 0 {
                                _ = write!(runs, "{} {},", previous.0, previous.1);
                            }
                            previous = (name, 0);
                        }
                        previous.1 += 1;
                    }
                    println!(
                        "{{\"id\":{id},\"runs\":\"{runs}{} {}\"}}",
                        previous.0, previous.1
                    );
                });
            }
            "strings" => {
                let case = Object::of(Some(&json));
                let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
                let path = case.str("filename").unwrap_or("file.js");
                let id = case.number("id").unwrap_or(-1.0);
                crate::with_file(path, code, &LanguageOptions::default(), |file| {
                    if file.has_parse_errors() || !code.is_ascii() {
                        println!("{{\"id\":{id},\"error\":true}}");
                        return;
                    }
                    let rule = (RuleEntry::of::<Strings>().build)(&Options::default());
                    let rules = [Enabled {
                        rule: &*rule,
                        severity: Severity::Error,
                    }];
                    let mut found = String::new();
                    for it in bun_lint::runner::run(file, &rules, false) {
                        let message = BStr::new(&it.message);
                        _ = write!(found, "{}-{} {message},", it.span.start, it.span.end);
                    }
                    println!("{{\"id\":{id},\"strings\":\"{found}\"}}");
                });
            }
            "text" => {
                let pair = json.as_array().unwrap_or_default();
                let text = |i: usize| pair.get(i).and_then(Json::as_str).unwrap_or_default();
                println!("{}", text_facts(text(0), text(1)));
            }
            _ => println!("{}", dump(Object::of(Some(&json)))),
        }
    }
}
