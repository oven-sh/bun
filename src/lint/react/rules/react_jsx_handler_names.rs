use crate::jsx::{AttributeValue, get_jsx_element_name, get_prop_value};
use crate::util_version::string_of;
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_lint::glob::Minimatch;
use bun_lint::prelude::*;
use bun_lint::regex::SyntaxError;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Enforce event handler naming conventions in JSX
pub struct JsxHandlerNames {
    check_inline_functions: bool,
    check_local_variables: bool,
    /// If empty, prop names aren't checked.
    event_handler_prop_prefixes: Vec<Box<[u8]>>,
    /// If empty, handler names aren't checked.
    event_handler_prefixes: Vec<Box<[u8]>>,
    ignore_component_names: Vec<Box<[u8]>>,
    /// `None` if [`Rule::validate`] rejected the options, in which case the rule doesn't run.
    upstream_options: Option<UpstreamOptions>,
}

/// The options that upstream parses differently from oxlint.
struct UpstreamOptions {
    /// Any truthy value counts as `true`.
    check_inline_function: bool,
    check_local: bool,
    event_handler_prefix: Vec<u8>,
    event_handler_prop_prefix: Vec<u8>,
    /// `None` if a prefix is `false`, or if both are plain names, which oxlint's lists already hold as is.
    regexes: Option<Regexes>,
    ignore_component_names: Vec<Minimatch>,
}

struct Regexes {
    event_handler: Regex,
    prop_event_handler: Regex,
}

/// Cached searches of the file's text.
#[derive(Default)]
pub struct TextSearchCache {
    /// Each `.` followed by a handler name, with the end of the part that makes it one.
    dots: OnceCell<Vec<(u32, u32)>>,
    /// Each `:` followed by another `:`, with the end of the second.
    colons: OnceCell<Vec<(u32, u32)>>,
    /// True if `EVENT_HANDLER_REGEX` matches the whole file's text.
    is_handler_name: OnceCell<bool>,
}

const BAD_HANDLER_NAME: Message = Message::new(
    "badHandlerName",
    "Handler function for {{propKey}} prop key must be a camelCase name beginning with '{{handlerPrefix}}' only",
);
const BAD_PROP_KEY: Message =
    Message::new("badPropKey", "Prop key for {{propValue}} must begin with '{{handlerPropPrefix}}'");
const OXLINT_BAD_HANDLER_NAME: Message = Message::new("", "Bad handler name");
const OXLINT_INVALID_HANDLER_NAME: Message = Message::new("", "Invalid handler name: {{handler_name}}");
const OXLINT_INVALID_HANDLER_PROP_NAME: Message = Message::new("", "Invalid handler prop name: {{prop_key}}");

#[derive(Copy, Clone)]
enum HandlerName<'a> {
    None,
    Name(&'a [u8]),
    /// Everything between the braces. It becomes a name after [`normalize_handler_name`].
    Text(Span),
}

impl Rule for JsxHandlerNames {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-handler-names", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = TextSearchCache;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        // `"a|b"`, or `false` for no prefixes.
        let prefixes = |key: &str, default: &str| -> Vec<Box<[u8]>> {
            let prefixes = match options.get(key) {
                Some(Json::Bool(false)) => &b""[..],
                Some(value) => value.as_str().unwrap_or(default.as_bytes()),
                None => default.as_bytes(),
            };
            strings::split(prefixes, b"|")
                .map(strings::trim_unicode_whitespace)
                .filter(|it| !it.is_empty())
                .map(Box::from)
                .collect()
        };
        let event_handler_prop_prefixes = prefixes("eventHandlerPropPrefix", "on");
        JsxHandlerNames {
            check_inline_functions: options.bool_or("checkInlineFunction", false),
            check_local_variables: options.bool_or("checkLocalVariables", false),
            event_handler_prefixes: match event_handler_prop_prefixes.is_empty() {
                true => Vec::new(),
                false => prefixes("eventHandlerPrefix", "handle"),
            },
            event_handler_prop_prefixes,
            ignore_component_names: options
                .strings("ignoreComponentNames")
                .into_iter()
                .map(|it| it.as_bytes().into())
                .collect(),
            upstream_options: UpstreamOptions::new(options).ok(),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        UpstreamOptions::new(options.object(0)).map(|_| ()).map_err(|error| error.message.into_bytes())
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<TextSearchCache> {
        // If the prop prefixes are empty, so are the handler prefixes.
        let has_prefixes = !self.event_handler_prop_prefixes.is_empty();
        let has_regexes = self.upstream_options.as_ref()?.regexes.is_some();
        (has_prefixes || (!file.language().is_oxlint && has_regexes)).then(TextSearchCache::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}

impl UpstreamOptions {
    /// The error is what `new RegExp(..)` throws.
    fn new(options: Object) -> Result<UpstreamOptions, SyntaxError> {
        // `isPrefixDisabled(prefix) ? null : prefix || default`, which is then interpolated into a template string.
        let prefix = |key: &str, default: &str| match options.get(key) {
            Some(Json::Bool(false)) => None,
            Some(value) if value.is_truthy() => Some(string_of(value)),
            _ => Some(default.as_bytes().to_vec()),
        };
        let is_plain = |key: &str| match options.get(key) {
            Some(Json::String(it)) => {
                !it.is_empty() && it.iter().all(|b| matches!(b, b'0'..=b'9' | b'A'..=b'Z' | b'_' | b'a'..=b'z'))
            }
            Some(value) => *value == Json::Bool(false),
            None => true,
        };
        let event_handler_prefix = prefix("eventHandlerPrefix", "handle");
        let event_handler_prop_prefix = prefix("eventHandlerPropPrefix", "on");
        let mut regexes = None;
        if !is_plain("eventHandlerPrefix") || !is_plain("eventHandlerPropPrefix") {
            let regex = |parts: &[&[u8]]| Regex::from_bytes(&parts.concat(), b"");
            let prop_prefix = event_handler_prop_prefix.as_deref().unwrap_or_default();
            let event_handler = (event_handler_prefix.as_deref())
                .map(|it| regex(&[b"^((props\\.", prop_prefix, b")|((.*\\.)?", it, b"))[0-9]*[A-Z].*$"]))
                .transpose()?;
            let prop_event_handler =
                event_handler_prop_prefix.as_deref().map(|it| regex(&[b"^(", it, b"[A-Z].*|ref)$"])).transpose()?;
            regexes = event_handler
                .zip(prop_event_handler)
                .map(|(event_handler, prop_event_handler)| Regexes { event_handler, prop_event_handler });
        }
        Ok(UpstreamOptions {
            check_inline_function: options.get("checkInlineFunction").is_some_and(Json::is_truthy),
            check_local: options.get("checkLocalVariables").is_some_and(Json::is_truthy),
            event_handler_prefix: event_handler_prefix.unwrap_or_default(),
            event_handler_prop_prefix: event_handler_prop_prefix.unwrap_or_default(),
            regexes,
            ignore_component_names: options
                .strings("ignoreComponentNames")
                .into_iter()
                .map(|it| Minimatch::new(it.as_bytes()))
                .collect(),
        })
    }

    /// Returns the span whose text upstream uses as the handler's name, or `None` if the attribute isn't checked.
    fn handler(&self, expression: Expr) -> Option<Span> {
        // True if it has an `object`.
        let is_member = |it: Expr| ast_utils::is_member_expression(it) && !it.is_chain_root();
        let Some(arrow_function) = expression.as_fn().filter(|it| it.is_arrow()) else {
            let span = match expression.is_missing() {
                true => expression.jsx_container_span()?.shrink(1, 1),
                false => expression.span(),
            };
            return (self.check_local || is_member(expression)).then_some(span);
        };
        // `expression.body.callee`
        let callee = match arrow_function.body() {
            FnBody::Expr(body) if !body.is_chain_root() => body.callee(),
            _ => None,
        };
        if !self.check_inline_function || !(self.check_local || callee.is_some_and(is_member)) {
            return None;
        }
        // `getText(undefined)` returns the whole file's text.
        Some(callee.map_or_else(|| expression.file().span(), Expr::span))
    }
}

impl JsxHandlerNames {
    fn check<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(upstream_options) = &self.upstream_options else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let regexes = upstream_options.regexes.as_ref().filter(|_| !is_oxlint);
        let mut is_ignored = None;
        for attribute in jsx.attrs() {
            let Some(AttributeValue::ExpressionContainer(value_expr)) = get_prop_value(attribute) else {
                continue;
            };
            let handler = match is_oxlint {
                true => self.handler(value_expr),
                // For upstream the name is a node's source text, whatever the node is.
                false => upstream_options.handler(value_expr).map(|span| (HandlerName::Text(span), span, false)),
            };
            let Some((handler_name, handler_span, is_props_handler)) = handler else {
                continue;
            };
            let Some(key) = attribute.key() else {
                continue;
            };
            let name = key.name().map(Name::bytes).unwrap_or_default();
            let prop_key = match strings::split_once_char(name, b':') {
                // For `a:b` oxlint uses `b`.
                Some((_, local)) if is_oxlint => local,
                // upstream has the node for `b` there, and converts it to a string.
                Some(_) => &b"[object Object]"[..],
                None => name,
            };
            // Any function can be a `ref`.
            if prop_key == b"ref" {
                continue;
            }
            let prop_is_event_handler = match regexes {
                Some(regexes) => regexes.prop_event_handler.test(prop_key),
                None => self.match_event_handler_props_name(prop_key),
            };
            let is_handler_name_correct = match handler_name {
                HandlerName::None => Some(false),
                // A handler passed down from the props may have a prop's name.
                HandlerName::Name(name) if is_props_handler && self.match_event_handler_props_name(name) => Some(true),
                HandlerName::Name(name) => self.match_event_handler_name(name),
                HandlerName::Text(span) => match regexes {
                    Some(regexes) => {
                        let test = || regexes.event_handler.test(&normalize_handler_name(cx.slice(span), is_oxlint));
                        // Every arrow function whose body isn't a call gets the file's text as its name, so that result
                        // is cached.
                        let is_file = span == cx.file().span();
                        if is_file {
                            Some(*cx.state.is_handler_name.get_or_init(test))
                        } else {
                            Some(test())
                        }
                    }
                    None => self.match_event_handler_name_in(span, cx),
                },
            };
            if is_handler_name_correct != Some(!prop_is_event_handler)
                || *is_ignored.get_or_insert_with(|| self.is_ignored_component(jsx, is_oxlint))
            {
                continue;
            }
            // upstream reports the attribute, and its message is what oxlint shows as the help text.
            if !is_oxlint {
                match prop_is_event_handler {
                    true => cx
                        .report(attribute.span(), BAD_HANDLER_NAME)
                        .data("propKey", prop_key)
                        .data("handlerPrefix", upstream_options.event_handler_prefix.clone()),
                    false => cx
                        .report(attribute.span(), BAD_PROP_KEY)
                        .data("propValue", normalize_handler_name(cx.slice(handler_span), is_oxlint))
                        .data("handlerPropPrefix", upstream_options.event_handler_prop_prefix.clone()),
                };
                continue;
            }
            let report = match (prop_is_event_handler, handler_name) {
                (true, HandlerName::Name(name)) => {
                    cx.report(handler_span, OXLINT_INVALID_HANDLER_NAME).data("handler_name", name)
                }
                (true, HandlerName::Text(span)) => cx
                    .report(handler_span, OXLINT_INVALID_HANDLER_NAME)
                    .data("handler_name", normalize_handler_name(cx.slice(span), is_oxlint)),
                (true, HandlerName::None) => cx.report(handler_span, OXLINT_BAD_HANDLER_NAME),
                (false, _) => {
                    cx.report(key.span(cx.file()), OXLINT_INVALID_HANDLER_PROP_NAME).data("prop_key", prop_key)
                }
            };
            report.help_with(|| {
                let text = |it: &[u8]| bstr::BStr::new(it).to_string();
                let prefixes = |it: &[Box<[u8]>]| text(&it.join(&b"|"[..]));
                if prop_is_event_handler {
                    return format!(
                        "Handler function for {} prop key must be a camelCase name beginning with '{}' only",
                        text(prop_key),
                        prefixes(&self.event_handler_prefixes),
                    );
                }
                let prop_value = match handler_name {
                    HandlerName::None => String::new(),
                    HandlerName::Name(name) => format!(" for {}", text(name)),
                    HandlerName::Text(span) => {
                        format!(" for {}", text(&normalize_handler_name(cx.slice(span), is_oxlint)))
                    }
                };
                format!("Prop key{prop_value} must begin with '{}'", prefixes(&self.event_handler_prop_prefixes))
            });
        }
    }

    /// Returns the handler's name if it has one, its span, and whether it's `props.name` or `this.props.name`. `None`
    /// if the attribute isn't checked.
    fn handler<'a>(&self, value_expr: Expr<'a>) -> Option<(HandlerName<'a>, Span, bool)> {
        let is_plain = !value_expr.is_parenthesized() && !value_expr.is_chain_root();
        let named = |(name, is_props_handler): (Ident<'a>, bool)| {
            (HandlerName::Name(name.bytes()), name.span(), is_props_handler)
        };
        match value_expr.kind() {
            ExprKind::Fn(arrow_function) if is_plain && arrow_function.is_arrow() => {
                if !self.check_inline_functions {
                    return None;
                }
                // `() => a.b()`, not `() => { a.b() }`
                let callee = match arrow_function.body() {
                    FnBody::Expr(body) if !body.is_parenthesized() && !body.is_chain_root() => {
                        body.as_call().map(Call::callee)
                    }
                    _ => None,
                };
                let callee = callee.filter(|it| !it.is_parenthesized());
                if !self.check_local_variables
                    && !callee.is_some_and(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index))
                {
                    return None;
                }
                let body = || match arrow_function.body() {
                    FnBody::Expr(body) => Some(body.outer_span()),
                    _ => arrow_function.body_span(),
                };
                match callee.map(|it| (it, it.kind())) {
                    Some((callee, ExprKind::Ident(name))) => {
                        Some((HandlerName::Name(name.bytes()), callee.span(), false))
                    }
                    Some((callee, ExprKind::Dot { .. })) if !callee.is_private_member() => {
                        get_event_handler_name_from_static_member_expression(callee).map(named)
                    }
                    _ => Some((HandlerName::None, body()?, false)),
                }
            }
            ExprKind::Ident(name) if is_plain => {
                self.check_local_variables.then(|| (HandlerName::Name(name.bytes()), value_expr.span(), false))
            }
            ExprKind::Dot { .. } if is_plain && !value_expr.is_private_member() => {
                get_event_handler_name_from_static_member_expression(value_expr).map(named)
            }
            // Everything between the braces is the name, and it's a bad one.
            _ => {
                if !self.check_local_variables
                    && !(is_plain && matches!(value_expr.tag(), ExprTag::Dot | ExprTag::Index))
                {
                    return None;
                }
                let span = value_expr.jsx_container_span()?.shrink(1, 1);
                Some((HandlerName::Text(span), span, false))
            }
        }
    }

    /// `/^(on)[A-Z].*$/`
    fn match_event_handler_props_name(&self, name: &[u8]) -> bool {
        self.event_handler_prop_prefixes
            .iter()
            .any(|it| name.strip_prefix(&**it).is_some_and(starts_with_upper))
    }

    /// `/^((.*\.)?(handle))[0-9]*[A-Z].*$/`. `None` if handler names aren't checked.
    fn match_event_handler_name(&self, name: &[u8]) -> Option<bool> {
        if self.event_handler_prefixes.is_empty() {
            return None;
        }
        let matches_at_start = |name: &[u8]| {
            self.event_handler_prefixes.iter().filter_map(|it| name.strip_prefix(&**it)).any(|rest| {
                starts_with_upper(
                    rest.get(rest.iter().take_while(|it| it.is_ascii_digit()).count()..).unwrap_or_default(),
                )
            })
        };
        let mut rest = name;
        loop {
            if matches_at_start(rest) {
                return Some(true);
            }
            match strings::split_once_char(rest, b'.') {
                Some((_, after)) => rest = after,
                None => return Some(false),
            }
        }
    }

    /// [`JsxHandlerNames::match_event_handler_name`] of [`normalize_handler_name`] of the text in `span`, without
    /// building the normalized text. Attributes can be nested with a lot of text in the innermost one, so that would be
    /// quadratic.
    fn match_event_handler_name_in(&self, span: Span, cx: &Cx<Self>) -> Option<bool> {
        if self.event_handler_prefixes.is_empty() {
            return None;
        }
        let (text, is_oxlint) = (cx.file().text(), cx.language().is_oxlint);
        let start = match is_oxlint {
            true => span.start + if cx.slice(span).starts_with(b"this.") { 5 } else { 0 },
            // upstream strips whitespace first, and if there's no `this.` it removes everything up to the last `::`.
            false => end_of_literal(text, span.start, b"this.", is_oxlint)
                .filter(|end| *end <= span.end)
                .or_else(|| self.last_match_end(b':', span, cx))
                .unwrap_or(span.start),
        };
        let is_name_at = |prefixes: &[Box<[u8]>], at: u32| {
            end_of_handler_name_start(prefixes, text, at, is_oxlint).is_some_and(|end| end <= span.end)
        };
        // For upstream `props.onChange` is a valid name, whatever follows it.
        let is_props_handler_name = || {
            end_of_literal(text, start, b"props.", is_oxlint)
                .is_some_and(|at| is_name_at(&self.event_handler_prop_prefixes, at))
        };
        Some(
            is_name_at(&self.event_handler_prefixes, start)
                || (!is_oxlint && is_props_handler_name())
                || self.last_match_end(b'.', Span::new(start, span.end), cx).is_some(),
        )
    }

    /// Returns the end of the last match that [`JsxHandlerNames::for_each_match`] finds for `byte` entirely inside
    /// `within`.
    fn last_match_end(&self, byte: u8, within: Span, cx: &Cx<Self>) -> Option<u32> {
        if within.len() <= 256 {
            let mut last = None;
            self.for_each_match(byte, within, cx.file(), &mut |_, end| {
                if end <= within.end {
                    last = Some(end);
                }
            });
            return last;
        }
        let all = if byte == b'.' { &cx.state.dots } else { &cx.state.colons }.get_or_init(|| {
            let mut all = Vec::new();
            self.for_each_match(byte, cx.file().span(), cx.file(), &mut |at, end| all.push((at, end)));
            all
        });
        let first = all.partition_point(|it| it.0 < within.start);
        let inside = all.get(first..all.partition_point(|it| it.0 < within.end))?;
        inside.iter().rev().find(|it| it.1 <= within.end).map(|it| it.1)
    }

    /// Calls `visit` with the offset of each `.` in `within` that's followed by a handler name, or each `:` followed by
    /// a `:`, and with the end of that match.
    fn for_each_match(&self, byte: u8, within: Span, file: &File, visit: &mut dyn FnMut(u32, u32)) {
        let (text, is_oxlint) = (file.text(), file.language().is_oxlint);
        let (mut at, end) = (within.start as usize, within.end as usize);
        while let Some(found) = text.get(at..end).and_then(|rest| strings::index_of_char_usize(rest, byte)) {
            at += found + 1;
            let match_end = match byte {
                b'.' => end_of_handler_name_start(&self.event_handler_prefixes, text, at as u32, is_oxlint),
                _ => end_of_literal(text, at as u32, b":", is_oxlint),
            };
            if let Some(match_end) = match_end {
                visit(at as u32 - 1, match_end);
            }
        }
    }

    /// For `<a.b.c.d>` the name that's compared is `a.c.d`, as in oxlint.
    fn is_ignored_component(&self, jsx: Jsx, is_oxlint: bool) -> bool {
        // upstream uses minimatch, which throws on what upstream passes it for `<a.b>` and `<a:b>`.
        if !is_oxlint {
            let name = get_jsx_element_name(jsx);
            let mut ignored = self.upstream_options.iter().flat_map(|it| &it.ignore_component_names);
            return strings::index_of_any(&name, b".:").is_none() && ignored.any(|it| it.matches(&name));
        }
        if self.ignore_component_names.is_empty() {
            return false;
        }
        let Some(mut at) = jsx.tag() else {
            return false;
        };
        let mut names: Vec<&[u8]> = Vec::new();
        while let ExprKind::Dot { obj, name, .. } = at.kind() {
            names.push(name.bytes());
            at = obj;
        }
        names.pop();
        names.push(at.text());
        names.reverse();
        let component_name = names.join(&b"."[..]);
        self.ignore_component_names.iter().any(|it| glob_match(it, &component_name))
    }
}

fn starts_with_upper(text: &[u8]) -> bool {
    text.first().is_some_and(u8::is_ascii_uppercase)
}

/// Returns the first non-whitespace character of `text` at or after `at`, and its end.
fn next_character(text: &[u8], at: u32, is_oxlint: bool) -> Option<(&[u8], u32)> {
    let mut at = at as usize;
    loop {
        let (c, size) = strings::wtf8_codepoint_at(text, at);
        let character = text.get(at..at + size).filter(|it| !it.is_empty())?;
        at += size;
        // oxlint uses Unicode's `White_Space`, upstream uses `\s`.
        let is_blank = match is_oxlint {
            true => char::from_u32(c).is_some_and(char::is_whitespace),
            false => strings::is_js_whitespace(c),
        };
        if !is_blank {
            return Some((character, at as u32));
        }
    }
}

/// Returns where `literal` ends in the text starting at `from`, ignoring whitespace.
fn end_of_literal(text: &[u8], from: u32, literal: &[u8], is_oxlint: bool) -> Option<u32> {
    let (mut at, mut rest) = (from, literal);
    while !rest.is_empty() {
        let (character, end) = next_character(text, at, is_oxlint)?;
        rest = rest.strip_prefix(character)?;
        at = end;
    }
    Some(at)
}

/// Returns where the capital letter of `/^(handle)[0-9]*[A-Z]/` ends in the text starting at `from`, ignoring
/// whitespace.
fn end_of_handler_name_start(prefixes: &[Box<[u8]>], text: &[u8], from: u32, is_oxlint: bool) -> Option<u32> {
    let end_with = |prefix: &[u8]| {
        let mut at = end_of_literal(text, from, prefix, is_oxlint)?;
        loop {
            let (character, end) = next_character(text, at, is_oxlint)?;
            if !character.iter().all(u8::is_ascii_digit) {
                return starts_with_upper(character).then_some(end);
            }
            at = end;
        }
    };
    prefixes.iter().filter_map(|it| end_with(it)).min()
}

/// Returns the name, and whether it's a member of `props` or `this.props`.
fn get_event_handler_name_from_static_member_expression(member_expr: Expr<'_>) -> Option<(Ident<'_>, bool)> {
    let ExprKind::Dot { obj, name, .. } = member_expr.kind() else {
        return None;
    };
    let is_props_handler = !obj.is_parenthesized()
        && match obj.kind() {
            ExprKind::Ident(obj_name) => obj_name.is("props"),
            ExprKind::Dot { obj: this, name: obj_name, .. } => {
                this.tag() == ExprTag::This && !this.is_parenthesized() && obj_name.name().is("props")
            }
            _ => false,
        };
    Some((name, is_props_handler))
}

/// Strips a leading `this.` and all whitespace.
fn normalize_handler_name(s: &[u8], is_oxlint: bool) -> Vec<u8> {
    // upstream: `.replace(/\s*/g, "").replace(/^this\.|.*::/, "")`
    if !is_oxlint {
        let name = strings::without_js_whitespace(s);
        let start = match name.starts_with(b"this.") {
            true => 5,
            false => strings::last_index_of(&name, b"::").map_or(0, |at| at + 2),
        };
        return name.get(start..).unwrap_or_default().to_vec();
    }
    let s = s.strip_prefix(b"this.").unwrap_or(s);
    match std::str::from_utf8(s) {
        Ok(s) => s.chars().filter(|c| !c.is_whitespace()).collect::<String>().into_bytes(),
        Err(_) => s.iter().copied().filter(|c| !c.is_ascii_whitespace()).collect(),
    }
}
