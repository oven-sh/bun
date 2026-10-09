//! What the rules of `jest` and of `vitest` about tests and suites do: `it(..)`, `describe(..)`, their titles and their callbacks. Each
//! module is a file of oxlint's `rules/shared/jest_vitest`. See [`jest`](crate::jest).

use crate::jest::{
    Ctx, JEST_METHOD_NAMES, JestFnKind, JestGeneralFnKind, MemberExpressionElement, OxlintOrder,
    ParsedGeneralJestFnCall, PossibleJestNode, Scopes, is_in_call_or_member,
    is_type_of_jest_fn_call, is_vitest, iter_possible_jest_call_node, parent_expression,
    parse_general_jest_fn_call, parse_jest_fn_call,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{
    get_inner_expression, get_member_expr, is_global_turned_off, static_property_name,
};
use bun_lint_oxlint::regex_flags::rust_regex;
use bun_lint_oxlint::text::{trim, trim_start};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

pub(crate) mod no_focused_tests {
    use super::*;

    const NO_FOCUSED_TESTS: Message = Message::new("", "Unexpected focused test.");
    const REMOVE_FOCUS: Message = Message::new("", "Remove focus from test.");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        let ParsedGeneralJestFnCall {
            kind,
            members,
            name,
        } = jest_fn_call;
        if !matches!(
            kind,
            JestFnKind::General(JestGeneralFnKind::Describe | JestGeneralFnKind::Test)
        ) {
            return;
        }
        if name.starts_with(b"f") {
            let start = possible_jest_node.node.span().start;
            ctx.report(
                Span::new(start, start + name.len() as u32),
                NO_FOCUSED_TESTS,
            )
            .suggest(REMOVE_FOCUS, |fixer| {
                fixer.remove(Span::new(start, start + 1))
            });
            return;
        }
        if let Some(only_node) = members.iter().find(|member| member.is_name_equal("only")) {
            ctx.report(only_node.span, NO_FOCUSED_TESTS)
                .suggest(REMOVE_FOCUS, |fixer| {
                    // With the `.`, or with the brackets.
                    let is_computed =
                        !matches!(only_node.element, MemberExpressionElement::IdentName(_));
                    fixer.remove(Span::new(
                        only_node.span.start.saturating_sub(1),
                        only_node.span.end + u32::from(is_computed),
                    ))
                });
        }
    }
}

pub(crate) mod no_disabled_tests {
    use super::*;

    const MISSING_FUNCTION: Message = Message::new("", "Test is missing function argument");
    const PENDING: Message = Message::new("", "Call to pending()");
    const DISABLED_SUITE: Message = Message::new("", "Disabled test suite");
    const DISABLED_TEST: Message = Message::new("", "Disabled test");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let node = possible_jest_node.node;
        let Some(call_expr) = node.as_call() else {
            return;
        };
        let callee = call_expr.callee();
        let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
            if callee.is_ident("pending")
                && !callee.is_parenthesized()
                && callee.symbol().is_none()
                && !is_global_turned_off(ctx.file, "pending")
            {
                ctx.report(node, PENDING);
            }
            return;
        };
        let ParsedGeneralJestFnCall {
            kind,
            members,
            name,
        } = jest_fn_call;
        let JestFnKind::General(kind) = kind else {
            return;
        };
        if kind == JestGeneralFnKind::Test
            && call_expr.args().len() < 2
            && members.iter().all(|member| member.is_name_unequal("todo"))
        {
            ctx.report(node, MISSING_FUNCTION);
        } else if name.starts_with(b"x")
            || members.iter().any(|member| member.is_name_equal("skip"))
        {
            ctx.report(
                callee,
                if kind == JestGeneralFnKind::Describe {
                    DISABLED_SUITE
                } else {
                    DISABLED_TEST
                },
            );
        }
    }
}

pub(crate) mod valid_describe_callback {
    use super::*;

    const NAME_AND_CALLBACK: Message =
        Message::new("", "Describe requires name and callback arguments");
    const SECOND_ARGUMENT_MUST_BE_FUNCTION: Message =
        Message::new("", "Second argument must be a function");
    const NO_ASYNC_DESCRIBE_CALLBACK: Message = Message::new("", "No async describe callback");
    const UNEXPECTED_DESCRIBE_ARGUMENT: Message =
        Message::new("", "Unexpected argument(s) in describe callback");
    const UNEXPECTED_RETURN_IN_DESCRIBE: Message =
        Message::new("", "Unexpected return statement in describe callback");

    /// `is_for_vitest`: the callback can be `async`, and there can be options before it.
    pub(crate) fn run<'a>(
        possible_jest_node: PossibleJestNode<'a>,
        ctx: &Ctx<'a, '_>,
        is_for_vitest: bool,
    ) {
        let node = possible_jest_node.node;
        let Some(call_expr) = node.as_call() else {
            return;
        };
        let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        if jest_fn_call.kind != JestFnKind::General(JestGeneralFnKind::Describe) {
            return;
        }
        let (callee, arguments) = (call_expr.callee(), call_expr.args());

        // `describe.todo("title")`
        if arguments.len() == 1
            && matches!(callee.tag(), ExprTag::Dot | ExprTag::Index)
            && is_vitest(ctx.file)
            && static_property_name(callee).is_none_or(|it| it.is("todo"))
        {
            return;
        }
        let Some(second) = arguments.get(1) else {
            ctx.report(
                arguments
                    .first()
                    .map_or_else(|| node.span(), Expr::outer_span),
                NAME_AND_CALLBACK,
            );
            return;
        };
        let as_function = |arg: Expr<'a>| arg.as_fn().filter(|_| !arg.is_parenthesized());
        let callback = match arguments.get(2) {
            Some(third)
                if is_for_vitest
                    && as_function(second).is_none()
                    && as_function(third).is_some() =>
            {
                third
            }
            _ => second,
        };
        let Some(func) = as_function(callback) else {
            ctx.report(callback.outer_span(), SECOND_ARGUMENT_MUST_BE_FUNCTION);
            return;
        };
        if func.is_async() && !is_for_vitest {
            ctx.report(callback, NO_ASYNC_DESCRIBE_CALLBACK);
        }
        let is_parameterized = jest_fn_call
            .members
            .iter()
            .any(|member| member.is_name_equal("each") || member.is_name_equal("for"));
        if !is_parameterized && !func.params().is_empty() {
            ctx.report(callback, UNEXPECTED_DESCRIBE_ARGUMENT);
        }
        match func.body() {
            FnBody::Expr(body)
                if body.tag() == ExprTag::Call
                    && !body.is_parenthesized()
                    && !body.is_chain_root() =>
            {
                ctx.report(body, UNEXPECTED_RETURN_IN_DESCRIBE);
            }
            FnBody::Block(statements) => {
                if let Some(return_stmt) = statements.iter().find(|it| it.tag() == StmtTag::Return)
                {
                    ctx.report(return_stmt, UNEXPECTED_RETURN_IN_DESCRIBE);
                }
            }
            _ => {}
        }
    }
}

pub(crate) mod valid_title {
    use super::*;

    const TITLE_MUST_BE_STRING: Message = Message::new("", "Title must be a string");
    const EMPTY_TITLE: Message = Message::new("", "Should not have an empty title");
    const DUPLICATE_PREFIX: Message = Message::new("", "Should not have duplicate prefix");
    const ACCIDENTAL_SPACE: Message =
        Message::new("", "Should not have leading or trailing spaces");
    const DISALLOWED_WORD: Message = Message::new("", "{{word}} is not allowed in test title");
    /// For `mustMatch` and `mustNotMatch`, which can come with a message.
    const CONFIGURED: Message = Message::new("", "{{message}}");
    const MUST_MATCH: Message = Message::new("", "{{name}} should match {{pattern}}");
    const MUST_NOT_MATCH: Message = Message::new("", "{{name}} should not match {{pattern}}");

    struct CompiledMatcherAndMessage {
        regex: Regex,
        /// As oxlint prints it.
        raw_pattern: String,
        message: Option<String>,
    }

    /// For `describe`, `it` and `test`.
    type MatcherPatterns = [Option<CompiledMatcherAndMessage>; 3];

    pub(crate) struct ValidTitleConfig {
        ignore_type_of_test_name: bool,
        ignore_type_of_describe_name: bool,
        allow_arguments: bool,
        disallowed_words_reg: Option<Regex>,
        ignore_spaces: bool,
        must_not_match_patterns: MatcherPatterns,
        must_match_patterns: MatcherPatterns,
    }

    /// `pattern`: `/pattern/flags`, of which the flags are ignored, or a pattern.
    fn compile_matcher_pattern(
        pattern: &Json,
        message: Option<&Json>,
    ) -> Option<CompiledMatcherAndMessage> {
        let pattern = std::str::from_utf8(pattern.as_str()?).ok()?;
        let literal = pattern
            .strip_prefix('/')
            .and_then(|it| it.get(..strings::last_index_of_char(it.as_bytes(), b'/')?));
        Some(CompiledMatcherAndMessage {
            regex: rust_regex(literal.unwrap_or(pattern), false)?,
            raw_pattern: literal.map_or_else(|| format!("(?u){pattern}"), str::to_owned),
            message: message
                .and_then(Json::as_str)
                .and_then(|it| std::str::from_utf8(it).ok())
                .map(str::to_owned),
        })
    }

    /// `["/pattern/", "message"]`, `"/pattern/"` or `{ "describe": "/pattern/" }`
    fn compile_matcher_patterns(matcher_patterns: Option<&Json>) -> MatcherPatterns {
        let for_all = |pattern: Option<&Json>, message: Option<&Json>| {
            [(); 3].map(|()| pattern.and_then(|pattern| compile_matcher_pattern(pattern, message)))
        };
        match matcher_patterns {
            Some(Json::Array(value)) => for_all(value.first(), value.get(1)),
            Some(Json::Object(_)) => ["describe", "it", "test"].map(|key| {
                matcher_patterns
                    .and_then(|it| it.get(key.as_bytes()))
                    .and_then(|it| compile_matcher_pattern(it, None))
            }),
            _ => for_all(matcher_patterns, None),
        }
    }

    impl ValidTitleConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let config = options.object(0);
            let disallowed_words = config.strings("disallowedWords");
            let disallowed_words_reg = (!disallowed_words.is_empty()).then(|| {
                let mut pattern = b"\\b(?:".to_vec();
                for (i, word) in disallowed_words.iter().enumerate() {
                    if i > 0 {
                        pattern.push(b'|');
                    }
                    pattern.extend_from_slice(&text::escape_reg_exp(word.as_bytes()));
                }
                pattern.extend_from_slice(b")\\b");
                Regex::from_bytes(&pattern, b"iu").ok()
            });
            ValidTitleConfig {
                ignore_type_of_test_name: config.bool_or("ignoreTypeOfTestName", false),
                ignore_type_of_describe_name: config.bool_or("ignoreTypeOfDescribeName", false),
                allow_arguments: config.bool_or("allowArguments", false),
                disallowed_words_reg: disallowed_words_reg.flatten(),
                ignore_spaces: config.bool_or("ignoreSpaces", false),
                must_not_match_patterns: compile_matcher_patterns(config.get("mustNotMatch")),
                must_match_patterns: compile_matcher_patterns(config.get("mustMatch")),
            }
        }

        pub(crate) fn run<'a>(
            &self,
            possible_jest_fn_node: PossibleJestNode<'a>,
            ctx: &Ctx<'a, '_>,
        ) {
            let Some(arg) = possible_jest_fn_node
                .node
                .as_call()
                .and_then(|it| it.args().first())
            else {
                return;
            };
            let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_fn_node)
            else {
                return;
            };
            let need_report_name = match jest_fn_call.kind {
                JestFnKind::General(JestGeneralFnKind::Test) => !self.ignore_type_of_test_name,
                JestFnKind::General(JestGeneralFnKind::Describe) => {
                    let settings = ctx
                        .file
                        .settings()
                        .get(b"vitest")
                        .and_then(|it| it.get(b"typecheck"));
                    if settings.and_then(Json::as_bool) == Some(true) {
                        return;
                    }
                    !self.ignore_type_of_describe_name
                }
                _ => return,
            };
            if jest_fn_call
                .members
                .first()
                .is_some_and(|member| member.is_name_equal("extend"))
                || self.allow_arguments && arg.tag() == ExprTag::Ident && !arg.is_parenthesized()
            {
                return;
            }
            let title = match arg.kind() {
                _ if arg.is_parenthesized() => None,
                ExprKind::String(value) => Some((value.bytes(), arg.span())),
                // What a template with substitutions makes is not known.
                ExprKind::Template(template) => match template.as_static() {
                    Some(quasi) => Some((quasi.bytes(), arg.span())),
                    None => return,
                },
                // String.raw`foo`: the title is what is written.
                ExprKind::TaggedTemplate(tagged_template)
                    if is_string_raw_member_expression(tagged_template.callee()) =>
                {
                    match tagged_template.template().map(|it| (it.kind(), it.span())) {
                        Some((ExprKind::Template(quasi), span)) if quasi.exprs().is_empty() => {
                            Some((quasi.raw(0), span))
                        }
                        _ => return,
                    }
                }
                ExprKind::Binary { .. } if does_binary_expression_contain_string_node(arg) => {
                    return;
                }
                _ => None,
            };
            match title {
                Some((title, span)) => self.validate_title(title, span, jest_fn_call.name, ctx),
                None if need_report_name => {
                    ctx.report(arg.outer_span(), TITLE_MUST_BE_STRING);
                }
                None => {}
            }
        }

        fn validate_title<'a>(
            &self,
            title: &'a [u8],
            span: Span,
            name: &'a [u8],
            ctx: &Ctx<'a, '_>,
        ) {
            if title.is_empty() {
                ctx.report(span, EMPTY_TITLE);
                return;
            }
            if let Some(disallowed_words_reg) = &self.disallowed_words_reg
                && let Some(matched) = disallowed_words_reg.find(title)
            {
                ctx.report(span, DISALLOWED_WORD)
                    .data("word", matched.as_bytes());
                return;
            }
            // What is written is kept as it is written, with its escapes. Whitespace and a prefix that are written with
            // escapes are not taken away.
            let inner_span = span.shrink(1, 1);
            let raw_text = ctx.file.slice(inner_span);
            if !self.ignore_spaces && trim(title).len() != title.len() {
                let report = ctx.report(span, ACCIDENTAL_SPACE);
                if can_trim_raw_title(title, raw_text) {
                    report.fix(|fixer| fixer.replace(inner_span, trim(raw_text)));
                }
            }
            let prefix = name.iter().take_while(|b| matches!(b, b'f' | b'x')).count();
            let un_prefixed_name = name.get(prefix..).unwrap_or_default();
            if strings::split(title, b" ").next() == Some(un_prefixed_name) {
                let without_prefix =
                    |text: &'a [u8]| text.strip_prefix(un_prefixed_name)?.strip_prefix(b" ");
                let report = ctx.report(span, DUPLICATE_PREFIX);
                if let Some(unprefixed_raw) = without_prefix(raw_text)
                    && let Some(unprefixed_cooked) = without_prefix(title)
                    && can_trim_raw_title(unprefixed_cooked, unprefixed_raw)
                {
                    report.fix(|fixer| fixer.replace(inner_span, trim(unprefixed_raw)));
                }
                return;
            }
            let Some(jest_fn_name) = ["describe", "it", "test"]
                .iter()
                .position(|it| it.as_bytes() == un_prefixed_name)
            else {
                return;
            };
            let checks = [
                (&self.must_match_patterns, true, MUST_MATCH),
                (&self.must_not_match_patterns, false, MUST_NOT_MATCH),
            ];
            for (patterns, must_match, default_message) in checks {
                let Some(Some(matcher)) = patterns.get(jest_fn_name) else {
                    continue;
                };
                if matcher.regex.test(title) == must_match {
                    continue;
                }
                match &matcher.message {
                    Some(message) => ctx
                        .report(span, CONFIGURED)
                        .data("message", message.clone()),
                    None => (ctx
                        .report(span, default_message)
                        .data("name", un_prefixed_name))
                    .data("pattern", matcher.raw_pattern.clone()),
                };
            }
        }
    }

    /// Whether there is as much whitespace at the start and at the end of `raw` as of `cooked`.
    fn can_trim_raw_title(cooked: &[u8], raw: &[u8]) -> bool {
        let whitespace_around = |text: &[u8]| {
            let without_start = trim_start(text).len();
            (
                text.len().saturating_sub(without_start),
                without_start.saturating_sub(trim(text).len()),
            )
        };
        whitespace_around(cooked) == whitespace_around(raw)
    }

    /// `String.raw`, of the global `String`.
    fn is_string_raw_member_expression(expr: Expr) -> bool {
        get_member_expr(expr).is_some_and(|member| {
            static_property_name(member).is_some_and(|it| it.is("raw"))
                && member
                    .object()
                    .map(get_inner_expression)
                    .is_some_and(|it| it.is_ident("String") && it.symbol().is_none())
        })
    }

    /// Whether an operand of `a + b + c` is a string or a template.
    fn does_binary_expression_contain_string_node(expr: Expr) -> bool {
        let is_string_literal = |it: Expr| {
            matches!(it.tag(), ExprTag::String | ExprTag::Template) && !it.is_parenthesized()
        };
        let mut at = expr;
        while let ExprKind::Binary { op, left, right } = at.kind()
            && !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
            && !at.is_parenthesized()
        {
            if is_string_literal(left) || is_string_literal(right) {
                return true;
            }
            at = left;
        }
        false
    }
}

pub(crate) mod consistent_test_it {
    use super::*;

    const CONSISTENT_METHOD: Message =
        Message::new("", "Enforce `test` and `it` usage conventions");

    #[derive(Copy, Clone)]
    pub(crate) struct ConsistentTestItConfig {
        within_describe: &'static str,
        r#fn: &'static str,
    }

    impl ConsistentTestItConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let config = options.object(0);
            let test_case_name = |key: &str| match config.str(key) {
                Some("it") => Ok(Some("it")),
                Some("test") => Ok(Some("test")),
                _ if config.has(key) => Err(()),
                _ => Ok(None),
            };
            match (test_case_name("withinDescribe"), test_case_name("fn")) {
                // What is not valid is as if nothing were configured, but that `withinDescribe` is what `fn` is.
                (Ok(None), Err(())) => ConsistentTestItConfig {
                    within_describe: "test",
                    r#fn: "test",
                },
                (Err(()), _) | (_, Err(())) => ConsistentTestItConfig {
                    within_describe: "it",
                    r#fn: "test",
                },
                (Ok(within_describe), Ok(r#fn)) => ConsistentTestItConfig {
                    within_describe: within_describe.or(r#fn).unwrap_or("it"),
                    r#fn: r#fn.unwrap_or("test"),
                },
            }
        }

        pub(crate) fn run_once<'a>(self, ctx: &Ctx<'a, '_>) {
            // The calls of `describe` around.
            let mut describe_stack: Vec<Span> = Vec::new();
            for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
                let node = possible_jest_node.node;
                while describe_stack
                    .last()
                    .is_some_and(|span| !span.contains(node.span()))
                {
                    describe_stack.pop();
                }
                let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_node)
                else {
                    continue;
                };
                let preferred = if describe_stack.is_empty() {
                    self.r#fn
                } else {
                    self.within_describe
                };
                match jest_fn_call.kind {
                    JestFnKind::General(JestGeneralFnKind::Describe) => {
                        describe_stack.push(node.span())
                    }
                    JestFnKind::General(JestGeneralFnKind::Test)
                        if !jest_fn_call.name.ends_with(preferred.as_bytes()) =>
                    {
                        if let Some(ident) = get_test_name(node) {
                            ctx.report(ident, CONSISTENT_METHOD).fix(|fixer| {
                                let prefix = match jest_fn_call.name.first() {
                                    _ if ident.is_ident("fit") => {
                                        return fixer.replace(ident, "test.only");
                                    }
                                    Some(b'x') => "x",
                                    Some(b'f') => "f",
                                    _ => "",
                                };
                                fixer.replace(ident, [prefix, preferred].concat())
                            });
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    /// The identifier that the chain starts with. There is none for `it["only"]()`.
    fn get_test_name(call_expr: Expr<'_>) -> Option<Expr<'_>> {
        let mut at = call_expr;
        loop {
            at = match at.kind() {
                ExprKind::Ident(_) => return Some(at),
                ExprKind::Dot { obj, .. } if !at.is_private_member() && !obj.is_parenthesized() => {
                    obj
                }
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                    get_inner_expression(call.callee())
                }
                _ => return None,
            };
        }
    }
}

pub(crate) mod max_nested_describe {
    use super::*;

    const EXCEEDED_MAX_DEPTH: Message =
        Message::new("", "Enforces a maximum depth to nested describe calls.");

    pub(crate) fn run_once<'a>(max: u32, ctx: &Ctx<'a, '_>) {
        let mut active_describes: Vec<Span> = Vec::new();
        for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
            if !is_type_of_jest_fn_call(
                ctx.file,
                possible_jest_node,
                &[JestFnKind::General(JestGeneralFnKind::Describe)],
            ) {
                continue;
            }
            let span = possible_jest_node.node.span();
            while active_describes
                .last()
                .is_some_and(|parent| !parent.contains(span))
            {
                active_describes.pop();
            }
            active_describes.push(span);
            if active_describes.len() as u32 > max {
                ctx.report(span, EXCEEDED_MAX_DEPTH);
            }
        }
    }
}

pub(crate) mod no_commented_out_tests {
    use super::*;

    const NO_COMMENTED_OUT_TESTS: Message =
        Message::new("", "Some tests appear to be inside comments.");

    fn is_regex_word_byte(byte: u8) -> bool {
        byte.is_ascii_alphanumeric() || byte == b'_'
    }

    /// `rest` without the bytes at its start for which `is_skipped` holds.
    fn skip(rest: &[u8], is_skipped: impl Fn(u8) -> bool) -> &[u8] {
        rest.get(rest.iter().take_while(|it| is_skipped(**it)).count()..)
            .unwrap_or_default()
    }

    fn strip_keyword(rest: &[u8]) -> Option<&[u8]> {
        ["describe", "test", "it"]
            .iter()
            .find_map(|it| rest.strip_prefix(it.as_bytes()))
    }

    /// Whether `line`, which goes on to the end of the comment, starts with `it(`, `xdescribe.only (`, `test["skip"](` or the like.
    fn starts_with_test(line: &[u8]) -> bool {
        let prefixed = match line.split_first() {
            Some((b'x' | b'f', rest)) => strip_keyword(rest),
            _ => None,
        };
        let Some(rest) = prefixed.or_else(|| strip_keyword(line)) else {
            return false;
        };
        let rest = match rest.split_first() {
            Some((b'.', method)) => match skip(method, is_regex_word_byte) {
                after if after.len() < method.len() => after,
                _ => return false,
            },
            Some((b'[', quoted)) => {
                let Some((quote @ (b'\'' | b'"'), method)) = quoted.split_first() else {
                    return false;
                };
                match skip(method, is_regex_word_byte) {
                    [end, b']', after @ ..] if end == quote && after.len() + 2 < method.len() => {
                        after
                    }
                    _ => return false,
                }
            }
            // `item`, `testSomething`
            Some((byte, _)) if is_regex_word_byte(*byte) || *byte == b'$' => return false,
            _ => rest,
        };
        skip(rest, |it| it.is_ascii_whitespace()).first() == Some(&b'(')
    }

    fn is_commented_out_test(text: &[u8]) -> bool {
        let mut rest = text;
        loop {
            let line = skip(rest, |it| matches!(it, b' ' | b'\t' | b'\r'));
            if starts_with_test(line) {
                return true;
            }
            match strings::index_of_char_usize(line, b'\n').and_then(|at| line.get(at + 1..)) {
                Some(next) => rest = next,
                None => return false,
            }
        }
    }

    pub(crate) fn run_once(ctx: &Ctx) {
        for comment in ctx
            .file
            .comments()
            .filter(|it| !it.text().starts_with(b"#!"))
        {
            if is_commented_out_test(comment.comment_value()) {
                let end = if comment.text().starts_with(b"/*") {
                    2
                } else {
                    0
                };
                ctx.report(comment.span().shrink(2, end), NO_COMMENTED_OUT_TESTS);
            }
        }
    }
}

pub(crate) mod no_conditional_in_test {
    use super::*;

    const NO_CONDITIONAL_IN_TEST: Message = Message::new("", "Avoid having conditionals in tests.");

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        let file = ctx.file;
        let mut tests = AncestorMemo::default();
        let mut check = |node: Node<'a>| {
            let is_test = |_, parent: Node<'a>| {
                let call_expr = parent.as_expr().filter(|it| it.tag() == ExprTag::Call)?;
                is_type_of_jest_fn_call(
                    file,
                    PossibleJestNode::new(call_expr),
                    &[JestFnKind::General(JestGeneralFnKind::Test)],
                )
                .then_some(())
            };
            if tests.find(node, is_test).is_some() {
                ctx.report(node.span(), NO_CONDITIONAL_IN_TEST);
            }
        };
        file.stmts_of_kind(StmtTag::If)
            .chain(file.stmts_of_kind(StmtTag::Switch))
            .for_each(|it| check(Node::Stmt(it)));
        file.exprs_of_kind(ExprTag::Cond)
            .for_each(|it| check(Node::Expr(it)));
        (file.exprs_of_kind(ExprTag::Binary).filter(|it| {
            matches!(
                it.binary_op(),
                Some(BinOp::And | BinOp::Or | BinOp::Nullish)
            )
        }))
        .for_each(|it| check(Node::Expr(it)));
    }
}

pub(crate) mod no_identical_title {
    use super::*;

    const DESCRIBE_REPEAT: Message = Message::new(
        "",
        "Describe block title is used multiple times in the same describe block.",
    );
    const TEST_REPEAT: Message = Message::new(
        "",
        "Test title is used multiple times in the same describe block.",
    );

    struct Titled<'a> {
        possible_jest_node: PossibleJestNode<'a>,
        /// The title.
        argument: Expr<'a>,
        is_describe: bool,
        /// A number for the block that it is in, which is greater for what oxc comes to later.
        parent: u32,
    }

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        let mut blocks = AncestorMemo::default();
        let mut title_to_calls: FxHashMap<Name<'a>, SmallVec<[Titled<'a>; 1]>> =
            FxHashMap::default();
        for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
            let node = possible_jest_node.node;
            let Some(argument) = node
                .as_call()
                .and_then(|it| it.args().first())
                .filter(|it| !it.is_parenthesized())
            else {
                continue;
            };
            let title = match argument.kind() {
                ExprKind::String(value) => value,
                ExprKind::Template(template) => match template.as_static() {
                    Some(quasi) => quasi,
                    None => continue,
                },
                _ => continue,
            };
            let Some(result) = parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
                continue;
            };
            let is_describe = match result.kind {
                JestFnKind::General(JestGeneralFnKind::Describe) => true,
                JestFnKind::General(JestGeneralFnKind::Test) => false,
                _ => continue,
            };
            if result.members.iter().any(|m| m.is_name_equal("each")) {
                continue;
            }
            // `get_closest_block`
            let parent = blocks.find(Node::Expr(node), |child, parent| match parent {
                Node::Stmt(statement) => {
                    (statement.tag() == StmtTag::Block).then(|| statement.span().start + 1)
                }
                Node::Func(func)
                    if child.as_stmt().is_some() && func.kind() != FnKind::StaticBlock =>
                {
                    func.body_span().map(|it| it.start + 1)
                }
                _ => None,
            });
            let titled = Titled {
                possible_jest_node,
                argument,
                is_describe,
                parent: parent.unwrap_or(0),
            };
            title_to_calls.entry(title).or_default().push(titled);
        }
        // oxlint sorts the calls with one title by the block, and compares each with the one before: a `describe('a')` that is
        // between `it('a')` and `test('a')` then keeps these two apart. It starts from the order of its list, and the sort is not
        // stable for more than 20: the same sort of as large elements in the same order does the same.
        let mut order = None;
        for calls in title_to_calls.values_mut().filter(|it| it.len() > 1) {
            let order = order.get_or_insert_with(|| OxlintOrder::new(ctx.file));
            calls.sort_by_cached_key(|it| order.key(it.possible_jest_node));
            let mut kind_and_spans: Vec<(Span, bool, u32)> = calls
                .iter()
                .map(|it| (it.argument.span(), it.is_describe, it.parent))
                .collect();
            kind_and_spans.sort_unstable_by_key(|it| it.2);
            for (previous, (span, is_describe, parent)) in
                kind_and_spans.iter().zip(kind_and_spans.iter().skip(1))
            {
                if *is_describe == previous.1 && *parent == previous.2 {
                    ctx.report(
                        *span,
                        if *is_describe {
                            DESCRIBE_REPEAT
                        } else {
                            TEST_REPEAT
                        },
                    );
                }
            }
        }
    }
}

pub(crate) mod no_test_prefixes {
    use super::*;

    const NO_TEST_PREFIXES: Message = Message::new("", "Use `{{preferred_node_name}}` instead.");

    type Names<'a> = SmallVec<[&'a [u8]; 4]>;

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(callee) = possible_jest_node.node.callee() else {
            return;
        };
        let Some((name, member_names)) = parse_no_test_prefixes_call(possible_jest_node, ctx.file)
        else {
            return;
        };
        let preferred_modifier = match name.first() {
            Some(b'f') => "only",
            Some(b'x') => "skip",
            _ => return,
        };
        if !matches!(
            JestFnKind::from(name),
            JestFnKind::General(JestGeneralFnKind::Describe | JestGeneralFnKind::Test)
        ) {
            return;
        }
        let span = match callee.kind() {
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) if !callee.is_parenthesized() => {
                call.callee().outer_span()
            }
            _ => callee.outer_span(),
        };
        let mut preferred_node_name = [
            name.get(1..).unwrap_or_default(),
            b".".as_slice(),
            preferred_modifier.as_bytes(),
        ]
        .concat();
        for member_name in member_names {
            preferred_node_name.push(b'.');
            preferred_node_name.extend_from_slice(member_name);
        }
        (ctx.report(span, NO_TEST_PREFIXES)
            .data("preferred_node_name", preferred_node_name.clone()))
        .fix(|fixer| fixer.replace(span, preferred_node_name));
    }

    /// The name as it is where it is from, and the names of the members.
    fn parse_no_test_prefixes_call<'a>(
        possible_jest_node: PossibleJestNode<'a>,
        file: &'a File<'a>,
    ) -> Option<(&'a [u8], Names<'a>)> {
        if let Some(jest_fn_call) = parse_general_jest_fn_call(file, possible_jest_node) {
            return Some((
                jest_fn_call.name,
                jest_fn_call
                    .members
                    .iter()
                    .filter_map(|it| it.name())
                    .collect(),
            ));
        }
        // Vitest has no `xit.each`, so that it is not parsed.
        if !is_vitest(file) || is_in_call_or_member(possible_jest_node.node) {
            return None;
        }
        let (mut member_names, mut at) = (Names::new(), possible_jest_node.node);
        for _ in 0..256 {
            if at.is_parenthesized() && at != possible_jest_node.node {
                return None;
            }
            at = match at.kind() {
                ExprKind::Ident(local_name) => {
                    member_names.reverse();
                    return Some((
                        possible_jest_node
                            .original
                            .unwrap_or_else(|| local_name.bytes()),
                        member_names,
                    ));
                }
                ExprKind::Dot { obj, name, .. } if !at.is_private_member() => {
                    member_names.push(name.bytes());
                    obj
                }
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => call.callee(),
                _ => return None,
            };
        }
        None
    }
}

pub(crate) mod no_test_return_statement {
    use super::*;

    const NO_TEST_RETURN_STATEMENT: Message =
        Message::new("", "Jest tests should not return a value");

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        for return_stmt in ctx.file.stmts_of_kind(StmtTag::Return) {
            if let Some(call_expr) = returned_expect_call(return_stmt)
                && is_in_test_context(return_stmt, ctx.file)
            {
                ctx.report(
                    Span::new(
                        return_stmt.span().start,
                        call_expr.span().start.saturating_sub(1),
                    ),
                    NO_TEST_RETURN_STATEMENT,
                );
            }
        }
    }

    /// The `expect(a).toBe(b)` of `return expect(a).toBe(b)`.
    fn returned_expect_call(return_stmt: Stmt<'_>) -> Option<Expr<'_>> {
        let StmtKind::Return(Some(call_expr)) = return_stmt.kind() else {
            return None;
        };
        let is_plain = |it: &Expr| !it.is_parenthesized() && !it.is_chain_root();
        let callee = Some(call_expr).filter(is_plain)?.as_call()?.callee();
        let mem_call_expr = Some(callee)
            .filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && is_plain(it))?
            .object()?;
        let ident = Some(mem_call_expr).filter(is_plain)?.as_call()?.callee();
        (ident.is_ident("expect") && !ident.is_parenthesized()).then_some(call_expr)
    }

    /// Whether `argument` is an argument of a call of `it` or `test`.
    fn is_test_callback<'a>(argument: Expr<'a>, file: &'a File<'a>) -> bool {
        parent_expression(argument).is_some_and(|call_node| {
            call_node
                .as_call()
                .is_some_and(|it| it.callee() != argument)
                && is_type_of_jest_fn_call(
                    file,
                    PossibleJestNode::new(call_node),
                    &[JestFnKind::General(JestGeneralFnKind::Test)],
                )
        })
    }

    fn is_in_test_context<'a>(return_stmt: Stmt<'a>, file: &'a File<'a>) -> bool {
        let Some(function) = Node::Stmt(return_stmt).enclosing_function() else {
            return false;
        };
        match function.owner() {
            Node::Expr(function_node) => is_test_callback(function_node, file),
            Node::Stmt(_) => {
                function
                    .name()
                    .and_then(|_| function.symbol())
                    .is_some_and(|symbol| {
                        symbol
                            .references()
                            .filter_map(Reference::expr)
                            .any(|it| is_test_callback(it, file))
                    })
            }
            _ => false,
        }
    }
}

pub(crate) mod prefer_each {
    use super::*;

    const USE_PREFER_EACH: Message =
        Message::new("", "Enforce using `each` rather than manual loops");

    pub(crate) fn should_run(file: &File) -> bool {
        file.has_stmts([StmtTag::For, StmtTag::ForIn, StmtTag::ForOf])
            && file.mentions_any(&JEST_METHOD_NAMES)
    }

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        let file = ctx.file;
        // The loop that something is in, if no call is between, and whether something is in a call of `it.each` or the like.
        let (mut loops, mut tests) = (AncestorMemo::default(), AncestorMemo::default());
        let mut skip = FxHashSet::default();
        for node in file.exprs_of_kind(ExprTag::Call) {
            let enclosing_loop = loops.find(Node::Expr(node), |_, parent| match parent {
                Node::Expr(e) => (e.tag() == ExprTag::Call).then_some(None),
                Node::Stmt(it) => {
                    matches!(it.tag(), StmtTag::For | StmtTag::ForIn | StmtTag::ForOf)
                        .then_some(Some(it))
                }
                _ => None,
            });
            let Some(Some(loop_node)) = enclosing_loop else {
                continue;
            };
            if skip.contains(&loop_node)
                || !matches!(
                    parse_jest_fn_call(file, PossibleJestNode::new(node)).map(|it| it.kind()),
                    Some(JestFnKind::General(
                        JestGeneralFnKind::Test
                            | JestGeneralFnKind::Describe
                            | JestGeneralFnKind::Hook
                    ))
                )
                || tests
                    .find(Node::Stmt(loop_node), |_, parent| {
                        is_member_of_test_called(parent).then_some(())
                    })
                    .is_some()
            {
                continue;
            }
            let (StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }) = loop_node.kind()
            else {
                continue;
            };
            skip.insert(loop_node);
            ctx.report(
                Span::new(loop_node.span().start, body.span().start),
                USE_PREFER_EACH,
            );
        }
    }

    /// `it.each(..)`, `test["only"](..)`
    fn is_member_of_test_called(node: Node) -> bool {
        (node.as_expr().and_then(Expr::as_call).map(Call::callee))
            .filter(|it| {
                matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && !it.is_parenthesized()
            })
            .and_then(|it| get_inner_expression(it.object()?).as_ident())
            .is_some_and(|id| {
                JestFnKind::from(id.bytes()) == JestFnKind::General(JestGeneralFnKind::Test)
            })
    }
}

pub(crate) mod prefer_lowercase_title {
    use super::*;

    const PREFER_LOWERCASE_TITLE: Message = Message::new("", "Enforce lowercase test names");

    pub(crate) struct PreferLowercaseTitleConfig {
        allowed_prefixes: Vec<String>,
        /// The names of the functions.
        ignores: Vec<&'static str>,
        ignore_top_level_describe: bool,
        lowercase_first_character_only: bool,
    }

    impl PreferLowercaseTitleConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let config = options.object(0);
            let ignore = config.strings("ignore");
            let aliases: [(&str, &[&'static str]); 4] = [
                ("describe", &["describe", "fdescribe", "xdescribe"]),
                ("bench", &["bench"]),
                ("test", &["test", "xtest"]),
                ("it", &["fit", "it", "xit"]),
            ];
            PreferLowercaseTitleConfig {
                allowed_prefixes: config
                    .strings("allowedPrefixes")
                    .into_iter()
                    .map(String::from)
                    .collect(),
                ignores: aliases
                    .iter()
                    .filter(|it| ignore.contains(&it.0))
                    .flat_map(|it| it.1.iter().copied())
                    .collect(),
                ignore_top_level_describe: config.bool_or("ignoreTopLevelDescribe", false),
                lowercase_first_character_only: config.bool_or("lowercaseFirstCharacterOnly", true),
            }
        }

        pub(crate) fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
            let node = possible_jest_node.node;
            let Some(arg) = node
                .as_call()
                .and_then(|it| it.args().first())
                .filter(|it| !it.is_parenthesized())
            else {
                return;
            };
            let literal = match arg.kind() {
                ExprKind::String(value) => value.bytes(),
                ExprKind::Template(template) => match template.as_static() {
                    Some(quasi) => quasi.bytes(),
                    None => return,
                },
                _ => return,
            };
            let is_upper = match self.lowercase_first_character_only {
                true => literal.first().is_some_and(u8::is_ascii_uppercase),
                false => literal.iter().any(u8::is_ascii_uppercase),
            };
            if !is_upper
                || self
                    .allowed_prefixes
                    .iter()
                    .any(|name| literal.starts_with(name.as_bytes()))
            {
                return;
            }
            let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_node)
            else {
                return;
            };
            let is_ignored = match jest_fn_call.kind {
                _ if self
                    .ignores
                    .iter()
                    .any(|it| it.as_bytes() == jest_fn_call.name) =>
                {
                    true
                }
                JestFnKind::General(JestGeneralFnKind::Describe) => {
                    self.ignore_top_level_describe
                        && Scopes::default().of(Node::Expr(node)).is_none()
                }
                JestFnKind::General(JestGeneralFnKind::Test | JestGeneralFnKind::Bench) => false,
                _ => true,
            };
            if !is_ignored {
                ctx.report(arg, PREFER_LOWERCASE_TITLE).fix(|fixer| {
                    let len = if self.lowercase_first_character_only {
                        1
                    } else {
                        literal.len()
                    };
                    let replacement = literal.get(..len).unwrap_or_default().to_ascii_lowercase();
                    let start = arg.span().start + 1;
                    fixer.replace(Span::new(start, start + len as u32), replacement)
                });
            }
        }
    }
}

pub(crate) mod prefer_todo {
    use super::*;

    const PREFER_TODO: Message = Message::new("", "Suggest using `test.todo`.");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let node = possible_jest_node.node;
        let Some(call_expr) = node.as_call() else {
            return;
        };
        let (callee, arguments) = (call_expr.callee(), call_expr.args());
        let Some(title) = arguments.first() else {
            return;
        };
        let is_filtered = match callee.as_ident() {
            Some(name) => matches!(name.bytes().first(), Some(b'x' | b'f')),
            None => static_property_name(callee).is_some_and(|it| it.is("todo")),
        };
        let is_empty_function = |it: Expr| {
            !it.is_parenthesized()
                && it
                    .as_fn()
                    .and_then(Func::body_statements)
                    .is_some_and(List::is_empty)
        };
        if is_filtered
            || !matches!(title.tag(), ExprTag::String | ExprTag::Template)
            || title.is_parenthesized()
            || !arguments.get(1).is_none_or(is_empty_function)
            || !is_type_of_jest_fn_call(
                ctx.file,
                possible_jest_node,
                &[JestFnKind::General(JestGeneralFnKind::Test)],
            )
        {
            return;
        }
        ctx.report(callee, PREFER_TODO).fix(|fixer| {
            let fix = match callee.kind() {
                ExprKind::Ident(_) => fixer.insert_after(callee, ".todo"),
                ExprKind::Dot { name, .. } if !callee.is_private_member() => {
                    fixer.replace(name.span(), "todo")
                }
                ExprKind::Index { index, .. } => fixer.replace(index.outer_span(), "'todo'"),
                _ => return vec![fixer.remove(node)],
            };
            match arguments.len() {
                1 => vec![fix],
                _ => vec![
                    fix,
                    fixer.remove(Span::new(
                        title.span().end,
                        node.span().end.saturating_sub(1),
                    )),
                ],
            }
        });
    }
}

pub(crate) mod require_top_level_describe {
    use super::*;

    const REQUIRE_TOP_LEVEL_DESCRIBE: Message = Message::new(
        "",
        "Require test cases and hooks to be inside a `describe` block",
    );

    pub(crate) fn max_number_of_top_level_describes(options: &Options) -> u32 {
        options
            .object(0)
            .number("maxNumberOfTopLevelDescribes")
            .map_or(u32::MAX, |it| it as u32)
    }

    pub(crate) fn run_once<'a>(max_number_of_top_level_describes: u32, ctx: &Ctx<'a, '_>) {
        let (mut scopes, mut count) = (Scopes::default(), 0);
        for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
            let node = possible_jest_node.node;
            let Some(ParsedGeneralJestFnCall {
                kind: JestFnKind::General(kind),
                ..
            }) = parse_general_jest_fn_call(ctx.file, possible_jest_node)
            else {
                continue;
            };
            if !matches!(
                kind,
                JestGeneralFnKind::Test | JestGeneralFnKind::Hook | JestGeneralFnKind::Describe
            ) || scopes.of(Node::Expr(node)).is_some()
            {
                continue;
            }
            // The first `describe` is never too many.
            if kind == JestGeneralFnKind::Describe
                && (count == 0 || count < max_number_of_top_level_describes)
            {
                count += 1;
            } else {
                ctx.report(node, REQUIRE_TOP_LEVEL_DESCRIBE);
            }
        }
    }
}

/// `padding_around_after_all_blocks`, `padding_around_test_blocks`
pub(crate) mod padding_around_blocks {
    use super::*;

    const PADDING_AROUND_JEST_BLOCK: Message =
        Message::new("", "Missing padding before {{name}} block");

    /// `is_for_tests`: for `it` and `test`. Otherwise for `afterAll`.
    pub(crate) fn run<'a>(ctx: &Ctx<'a, '_>, is_for_tests: bool) {
        let mut scopes = Scopes::default();
        for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
            let Some(ParsedGeneralJestFnCall { kind, name, .. }) =
                parse_general_jest_fn_call(ctx.file, possible_jest_node)
            else {
                continue;
            };
            let is_wanted = match is_for_tests {
                true => kind == JestFnKind::General(JestGeneralFnKind::Test),
                false => {
                    kind == JestFnKind::General(JestGeneralFnKind::Hook) && name == b"afterAll"
                }
            };
            if is_wanted {
                report_missing_padding_before_jest_block(
                    possible_jest_node.node,
                    &mut scopes,
                    ctx,
                    name,
                );
            }
        }
    }

    fn count_line_breaks(file: &File, start: u32, end: u32) -> usize {
        strings::count_char(file.slice(Span::new(start, end.max(start))), b'\n')
    }

    fn report_missing_padding_before_jest_block<'a>(
        node: Expr<'a>,
        scopes: &mut Scopes<'a>,
        ctx: &Ctx<'a, '_>,
        name: &'a [u8],
    ) {
        let (file, node_start) = (ctx.file, node.span().start);
        // Not in a block.
        let statements = match scopes.of(Node::Expr(node)) {
            None => Some(file.body()),
            Some(Node::Func(func)) if func.kind() != FnKind::StaticBlock => func.body_statements(),
            Some(_) => None,
        };
        // The last statement that ends before it, which is the one before that which it is in.
        let Some(prev_statement) = statements
            .and_then(|it| it.before(it.around(node_start)?.span().start))
            .filter(|it| it.directive().is_none() && it.span().end <= node_start)
        else {
            return;
        };
        let prev_statement_end = prev_statement.span().end;
        // Where the line ends that the statement ends in.
        let first_line_break =
            strings::index_of_char(file.slice(Span::new(prev_statement_end, node_start)), b'\n')
                .map_or(node_start, |at| prev_statement_end + at);
        // The comments right before it belong to it.
        let (mut span_between_start, mut span_between_end) = (prev_statement_end, node_start);
        for comment in file
            .comments_in(Span::new(prev_statement_end, node_start))
            .rev()
        {
            if count_line_breaks(file, comment.end(), span_between_end) > 1 {
                break;
            }
            if comment.start() <= first_line_break {
                span_between_start = comment.end();
                break;
            }
            span_between_end = comment.start();
        }
        if count_line_breaks(file, span_between_start, span_between_end) < 2 {
            ctx.report(Span::empty(node_start), PADDING_AROUND_JEST_BLOCK)
                .data("name", name)
                .fix(|fixer| {
                    let span_between =
                        Span::new(span_between_start, span_between_end.max(span_between_start));
                    let content = file.slice(span_between);
                    let whitespace_after_last_line = strings::last_index_of_char(content, b'\n')
                        .and_then(|at| content.get(at + 1..));
                    fixer.replace(
                        span_between,
                        [
                            b"\n\n".as_slice(),
                            whitespace_after_last_line.unwrap_or_default(),
                        ]
                        .concat(),
                    )
                });
        }
    }
}
