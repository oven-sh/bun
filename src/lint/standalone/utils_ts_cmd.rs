//! `bun-lint utils-ts ..`
//!
//! - `batch <cases.jsonl>`: for each line `{ id, filename, code, sourceType?, parserOptions? }`, what
//!   `bun_lint::utils::ts_utils` says about every node of the code, as a line of JSON in the format
//!   of `test/cli/lint/oracle/utils-ts/oracle.ts`. Positions are in bytes.
//! - `text <text.tsv>`: runs the helpers that take text on the lines of the file, and prints a line
//!   of JSON for each. A line is the name of a helper and its arguments in hexadecimal, separated by
//!   tabs. `test/cli/lint/oracle/utils-ts/text.ts` writes the file and compares.

use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::context::Severity;
use bun_lint::prelude::*;
use bun_lint::runner::{Enabled, RuleEntry};
use bun_lint::utils::estree_compat::{estree_parent, estree_span};
use bun_lint::utils::text::json_stringify;
use bun_lint::utils::ts_utils::{self, MemberAccessValue, OperatorPrecedence, WrappingFixerParams};
use std::fmt::Write as _;

fn string(text: &[u8]) -> String {
    String::from_utf8_lossy(&json_stringify(text)).into_owned()
}

/// Long text is compared by its length, its start and its end.
fn short(text: &[u8]) -> String {
    match text.len() > 160 {
        true => {
            let length = format!("..{}..", text.len());
            string(&[&text[..60], length.as_bytes(), &text[text.len() - 60..]].concat())
        }
        false => string(text),
    }
}

fn optional_string(text: Option<impl AsRef<[u8]>>) -> String {
    text.map_or_else(|| "null".to_owned(), |it| string(it.as_ref()))
}

fn range(span: Span) -> String {
    format!("[{},{}]", span.start, span.end)
}

fn optional_range(span: Option<Span>) -> String {
    span.map_or_else(|| "null".to_owned(), range)
}

fn list(all: impl IntoIterator<Item = impl std::fmt::Display>) -> String {
    let all: Vec<String> = all.into_iter().map(|it| it.to_string()).collect();
    format!("[{}]", all.join(","))
}

fn key(value: Option<MemberAccessValue>) -> String {
    match value {
        None => "null".to_owned(),
        Some(MemberAccessValue::String(value)) => string(&value),
        Some(MemberAccessValue::WellKnownSymbol(name)) => string(&[b"@@Symbol.", name].concat()),
        Some(MemberAccessValue::RegisteredSymbol(name)) => string(&[b"@@", &*name].concat()),
    }
}

#[derive(Default)]
struct Rows {
    rows: Vec<String>,
}

impl Rows {
    fn row(&mut self, name: &str, at: Span, value: impl std::fmt::Display) {
        self.rows
            .push(format!("[\"{name}\",{},{},{value}]", at.start, at.end));
    }

    fn expr<'a>(&mut self, e: Expr<'a>) {
        let (file, at) = (e.file(), e.span());
        self.row(
            "getOperatorPrecedenceForNode",
            at,
            ts_utils::get_operator_precedence_for_node(e) as i8,
        );
        self.row(
            "isStrongPrecedenceNode",
            at,
            ts_utils::is_strong_precedence_node(e),
        );
        self.row(
            "isWeakPrecedenceParent",
            at,
            ts_utils::is_weak_precedence_parent(e),
        );
        self.row("isConditionalTest", at, ts_utils::is_conditional_test(e));
        self.row("isNodeEqual", at, ts_utils::is_node_equal(e, e));
        self.row(
            "getMovedNodeCode",
            at,
            short(&ts_utils::get_moved_node_code(e, e)),
        );
        let has_arguments = matches!(e.kind(), ExprKind::New(call) if !call.args().is_empty());
        let precedence = ts_utils::get_operator_precedence(
            ts_utils::ts_syntax_kind(e),
            ts_utils::ts_operator_kind(e),
            has_arguments,
        );
        self.row("getOperatorPrecedence", at, precedence as i8);
        self.row(
            "getOperatorPrecedence(parent)",
            at,
            ts_utils::get_operator_precedence_of_ts_parent(e) as i8,
        );
        self.row(
            "isHigherPrecedenceThanAwait",
            at,
            ts_utils::is_higher_precedence_than_await(e),
        );
        self.row("isAssignee", at, ts_utils::is_assignee(e));
        match e.kind() {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.row(
                    "getStaticMemberAccessValue",
                    at,
                    key(ts_utils::get_static_member_access_value(e)),
                );
            }
            ExprKind::Binary { left, right, .. } => {
                self.row(
                    "isNodeEqual(left, right)",
                    at,
                    ts_utils::is_node_equal(left, right),
                );
            }
            ExprKind::String(value) => {
                self.row(
                    "getStringLength",
                    at,
                    ts_utils::get_string_length(value.bytes()),
                );
                self.row(
                    "requiresQuoting",
                    at,
                    ts_utils::requires_quoting(value.bytes()),
                );
                self.row(
                    "isDefinitionFile",
                    at,
                    ts_utils::is_definition_file(value.bytes()),
                );
            }
            _ => {}
        }
        self.row(
            "isStartOfExpressionStatement",
            at,
            ts_utils::is_start_of_expression_statement(e),
        );
        if let Some(first) = file.tokens_in(e).next() {
            self.row(
                "isStartOfExpressionStatementNeedingParentheses",
                at,
                ts_utils::is_start_of_expression_statement_needing_parentheses(e, &first),
            );
            self.row(
                "isStartOfArrowFunctionBodyNeedingParentheses",
                at,
                ts_utils::is_start_of_arrow_function_body_needing_parentheses(e, &first),
            );
        }
        self.row(
            "needsPrecedingSemicolon",
            at,
            ts_utils::needs_preceding_semicolon(e),
        );
        self.row(
            "getThisExpression",
            at,
            optional_range(ts_utils::get_this_expression(e).map(Expr::span)),
        );
        self.row(
            "getTextWithParentheses",
            at,
            short(ts_utils::get_text_with_parentheses(e)),
        );
        self.row(
            "getStaticStringValue",
            at,
            optional_string(ts_utils::get_static_string_value(e)),
        );
        let function = ts_utils::get_parent_function_node(e);
        self.row(
            "getParentFunctionNode",
            at,
            optional_range(function.map(|it| estree_span(Node::Func(it)))),
        );
        if matches!(e.kind(), ExprKind::Call(_)) {
            let mut object = None;
            ts_utils::is_array_method_call_with_predicate(e, |it| {
                object = Some(it.span());
                true
            });
            self.row("isArrayMethodCallWithPredicate", at, optional_range(object));
            let mut object = None;
            ts_utils::is_promise_aggregator_method(e, |it| {
                object = Some(it.span());
                true
            });
            self.row("isPromiseAggregatorMethod", at, optional_range(object));
        }
        if let Node::Expr(parent) = estree_parent(Node::Expr(e)) {
            self.row(
                "getMovedNodeCode(parent)",
                at,
                short(&ts_utils::get_moved_node_code(parent, e)),
            );
        }
        let predicates = [
            ts_utils::is_null_literal(e),
            ts_utils::is_undefined_identifier(e),
            ts_utils::is_optional_call_expression(e),
            ts_utils::is_logical_or_operator(e),
            ts_utils::is_type_assertion(e),
            ts_utils::is_await_expression(e),
        ];
        self.row("predicates", at, list(predicates));
    }

    fn name_of<'a>(&mut self, at: Span, node: impl Into<ts_utils::NodeWithKey<'a>>) {
        let node = node.into();
        let name = ts_utils::get_name_from_member(node);
        self.row(
            "getNameFromMember",
            at,
            format!("[{},{}]", string(&name.name), name.kind as u8),
        );
        self.row(
            "getStaticMemberAccessValue(member)",
            at,
            key(ts_utils::get_static_member_access_value(node)),
        );
    }

    fn func(&mut self, func: Func<'_>) {
        let at = estree_span(Node::Func(func));
        let kinds = [
            ts_utils::is_function(func),
            ts_utils::is_function_type(func),
            ts_utils::is_ts_function_type(func),
            ts_utils::is_ts_constructor_type(func),
        ];
        self.row("isFunctionType", at, list(kinds));
        if func.kind() == FnKind::Decl {
            self.row(
                "hasOverloadSignatures",
                at,
                ts_utils::has_overload_signatures(func),
            );
        }
        if !ts_utils::is_function(func) {
            return;
        }
        self.row(
            "getFunctionHeadLoc",
            at,
            range(ts_utils::get_function_head_loc(func)),
        );
        if func.is_arrow() {
            self.row(
                "isParenlessArrowFunction",
                at,
                ts_utils::is_parenless_arrow_function(func),
            );
        }
        if let Some(body) = func.body_statements() {
            let starts = ts_utils::walk_statements(body).map(|it| it.span().start);
            self.row("walkStatements", at, list(starts));
            let mut starts = Vec::new();
            ts_utils::for_each_return_statement(func, |it| {
                starts.push(it.span().start);
                None::<()>
            });
            self.row("forEachReturnStatement", at, list(starts));
        }
    }
}

impl<'a> Visitor<'a> for Rows {
    fn enter(&mut self, node: Node<'a>) {
        let at = node.span();
        for (name, holds) in [
            (
                "isClassOrTypeElement",
                ts_utils::is_class_or_type_element(node),
            ),
            (
                "isVariableDeclarator",
                ts_utils::is_variable_declarator(node),
            ),
            ("isLoop", ts_utils::is_loop(node)),
        ] {
            if holds {
                self.row(name, estree_span(node), true);
            }
        }
        match node {
            Node::Expr(e) => self.expr(e),
            Node::Func(func) => self.func(func),
            Node::Member(member) => {
                if member.kind() == MemberKind::IndexSignature {
                    self.row(
                        "getNameFromIndexSignature",
                        at,
                        string(ts_utils::get_name_from_index_signature(member)),
                    );
                    return;
                }
                self.name_of(at, member);
                self.row("isSetter", at, ts_utils::is_setter(member));
                self.row(
                    "getMemberHeadLoc",
                    at,
                    range(ts_utils::get_member_head_loc(member)),
                );
                self.row("isConstructor", at, ts_utils::is_constructor(member));
                self.row(
                    "needsPrecedingSemicolon(member)",
                    at,
                    ts_utils::needs_preceding_semicolon(member),
                );
                self.row(
                    "hasOverloadSignatures",
                    at,
                    ts_utils::has_overload_signatures(member),
                );
            }
            Node::Prop(prop) => {
                self.name_of(at, prop);
                self.row("isSetter", at, ts_utils::is_setter(prop));
            }
            Node::Param(param) if param.is_parameter_property() => {
                let name = param.pat().as_ident().map_or(&b""[..], |it| it.bytes());
                self.row(
                    "getParameterPropertyHeadLoc",
                    at,
                    range(ts_utils::get_parameter_property_head_loc(param, name)),
                );
            }
            Node::Stmt(statement) if statement.is_loop() => {
                self.row(
                    "getForStatementHeadLoc",
                    at,
                    range(ts_utils::get_for_statement_head_loc(statement)),
                );
            }
            Node::Type(ty) => {
                self.row(
                    "typeNodeRequiresParentheses",
                    at,
                    ts_utils::type_node_requires_parentheses(ty, ty.text()),
                );
            }
            _ => {}
        }
    }

    fn exit(&mut self, _: Node<'a>) {}
}

/// Reports every expression once for each way of making a wrapping fixer.
struct Probe;

const ADD: Message = Message::new("getWrappingFixer:add", "");
const ARRAY: Message = Message::new("getWrappingFixer:array", "");
const NONE: Message = Message::new("getWrappingFixer:none", "");
const ELEMENT_ADD: Message = Message::new("getWrappingFixer(element):add", "");
const ELEMENT_ARRAY: Message = Message::new("getWrappingFixer(element):array", "");
const PARENT: Message = Message::new("getWrappingFixer(parent)", "");

fn add(code: &[&[u8]]) -> Vec<u8> {
    [code[0], b" + 1"].concat()
}

fn array(code: &[&[u8]]) -> Vec<u8> {
    [b"[", code[0], b"]"].concat()
}

fn pair(code: &[&[u8]]) -> Vec<u8> {
    [b"(", code[0], b", ", code[1], b")"].concat()
}

impl Rule for Probe {
    const META: Meta = Meta::typescript("probe", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Probe
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.enter(NodeTags::ALL, |_, node, cx| {
            let Node::Expr(node) = node else {
                return;
            };
            let inner_nodes = &[];
            cx.report(node, ADD).fix(|fixer| {
                ts_utils::get_wrapping_fixer(
                    fixer,
                    WrappingFixerParams {
                        node,
                        inner_nodes,
                        wrap: add,
                    },
                )
            });
            cx.report(node, ARRAY).fix(|fixer| {
                ts_utils::get_wrapping_fixer(
                    fixer,
                    WrappingFixerParams {
                        node,
                        inner_nodes,
                        wrap: array,
                    },
                )
            });
            cx.report(node, NONE)
                .fix(|fixer| ts_utils::get_wrapping_fixer_without_wrap(fixer, node, inner_nodes));
            cx.report(node, ELEMENT_ADD).fix(|fixer| {
                let params = WrappingFixerParams {
                    node,
                    inner_nodes,
                    wrap: add,
                };
                ts_utils::get_wrapping_fixer_for_chain_element(fixer, params)
            });
            cx.report(node, ELEMENT_ARRAY).fix(|fixer| {
                let params = WrappingFixerParams {
                    node,
                    inner_nodes,
                    wrap: |code: &[&[u8]]| array(code),
                };
                ts_utils::get_wrapping_fixer_for_chain_element(fixer, params)
            });
            if let Node::Expr(parent) = estree_parent(Node::Expr(node)) {
                cx.report(node, PARENT).fix(|fixer| {
                    let params = WrappingFixerParams {
                        node: parent,
                        inner_nodes: &[node, node],
                        wrap: pair,
                    };
                    ts_utils::get_wrapping_fixer_for_chain_element(fixer, params)
                });
            }
        });
    }
}

fn dump(case: Object<'_>, rules: &[Enabled]) -> String {
    let id = case.number("id").unwrap_or(-1.0);
    let language = LanguageOptions {
        source_type: match case.str("sourceType") {
            Some("script") => SourceType::Script,
            Some("commonjs") => SourceType::CommonJs,
            _ => SourceType::Module,
        },
        parser_options: case.get("parserOptions").cloned().unwrap_or(Json::Null),
        ..LanguageOptions::default()
    };
    let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
    crate::with_file(
        case.str("filename").unwrap_or("file.ts"),
        code,
        &language,
        |file| {
            if file.has_parse_errors() {
                return format!("{{\"id\":{id},\"error\":true}}");
            }
            let mut rows = Rows::default();
            walk(file, &mut rows);
            let mut tokens = file.tokens().with_comments().peekable();
            while let Some(token) = tokens.next() {
                let bits = [
                    ts_utils::is_optional_chain_punctuator(&token),
                    ts_utils::is_non_null_assertion_punctuator(&token),
                    ts_utils::is_await_keyword(&token),
                    ts_utils::is_type_keyword(&token),
                    ts_utils::is_import_keyword(&token),
                    tokens
                        .peek()
                        .is_some_and(|next| ts_utils::is_token_on_same_line(file, token, next)),
                ];
                rows.row("tokens", token.span(), list(bits));
                if ts_utils::is_await_keyword(&token) {
                    rows.row(
                        "getAwaitTokenRemovalRange",
                        token.span(),
                        range(ts_utils::get_await_token_removal_range(file, token)),
                    );
                }
            }
            for symbol in file.symbols() {
                for declaration in symbol.declarations() {
                    if let Some(name) = declaration.name_span() {
                        rows.row("isTypeImport", name, ts_utils::is_type_import(declaration));
                        rows.row(
                            "isRestParameterDeclaration",
                            name,
                            ts_utils::is_rest_parameter_declaration(declaration),
                        );
                    }
                }
            }
            for it in bun_lint::runner::run(file, rules, true) {
                if let Some(fix) = it.fix {
                    let value =
                        format!("[{},{},{}]", fix.span.start, fix.span.end, short(&fix.text));
                    rows.row(it.message_id, it.span, value);
                }
            }
            let mut out = format!("{{\"id\":{id},\"rows\":[");
            let _ = write!(out, "{}]}}", rows.rows.join(","));
            out
        },
    )
}

fn unhex(text: &[u8]) -> Vec<u8> {
    let digit = |c: u8| (c as char).to_digit(16).unwrap_or(0) as u8;
    text.chunks_exact(2)
        .map(|pair| (digit(pair[0]) << 4) | digit(pair[1]))
        .collect()
}

/// The precedence whose number upstream is `text`.
fn precedence(text: &[u8]) -> OperatorPrecedence {
    use OperatorPrecedence::*;
    let all = [
        Invalid,
        Comma,
        Spread,
        Yield,
        Assignment,
        Conditional,
        LogicalOR,
        LogicalAND,
        BitwiseOR,
        BitwiseXOR,
        BitwiseAND,
        Equality,
        Relational,
        Shift,
        Additive,
        Multiplicative,
        Exponentiation,
        Unary,
        Update,
        LeftHandSide,
        Member,
        Primary,
    ];
    let number = String::from_utf8_lossy(text).parse::<i8>().unwrap_or(-1);
    all.into_iter()
        .find(|&it| it as i8 == number)
        .unwrap_or(Invalid)
}

fn call(line: &[u8]) -> String {
    let mut fields = bun_core::strings::split(line, b"\t");
    let name = fields.next().unwrap_or_default();
    let args: Vec<Vec<u8>> = fields.map(unhex).collect();
    let first = args.first().map_or(&b""[..], |it| it);
    match name {
        b"requiresQuoting" => ts_utils::requires_quoting(first).to_string(),
        b"getStringLength" => ts_utils::get_string_length(first).to_string(),
        b"upperCaseFirst" => string(&ts_utils::upper_case_first(first)),
        b"isDefinitionFile" => ts_utils::is_definition_file(first).to_string(),
        b"formatWordList" => string(&ts_utils::format_word_list(&args)),
        b"escapeRegExp" => string(&ts_utils::escape_reg_exp(first)),
        b"getWrappedCode" => string(&ts_utils::get_wrapped_code(
            first,
            precedence(&args[1]),
            precedence(&args[2]),
        )),
        _ => "null".to_owned(),
    }
}

pub(crate) fn run(args: &[String]) {
    let (Some(command @ ("batch" | "text")), Some(path)) =
        (args.first().map(String::as_str), args.get(1))
    else {
        println!("usage: bun-lint utils-ts batch <cases.jsonl> | text <text.tsv>");
        return;
    };
    let Ok(input) = std::fs::read(path) else {
        println!("cannot read {path}");
        return;
    };
    if command == "text" {
        for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
            println!("{}", call(line));
        }
        return;
    }
    let rule = (RuleEntry::of::<Probe>().build)(&Options::new(&[]));
    let rules = [Enabled {
        rule: &*rule,
        severity: Severity::Error,
    }];
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        match bun_lint::json::parse(line) {
            Some(case) => println!("{}", dump(Object::of(Some(&case)), &rules)),
            None => println!("{{\"error\":true}}"),
        }
    }
}
