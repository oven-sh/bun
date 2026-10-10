use crate::jsx::{AttributeValue, get_jsx_element_name, get_prop_value};
use crate::util_version::string_of;
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::prelude::*;
use bun_lint::regex::SyntaxError;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Enforce event handler naming conventions in JSX
pub struct JsxHandlerNames {
    check_inline_functions: bool,
    check_local_variables: bool,
    /// Empty: the names of the props are not looked at.
    event_handler_prop_prefixes: Vec<Box<[u8]>>,
    /// Empty: the names of the handlers are not looked at.
    event_handler_prefixes: Vec<Box<[u8]>>,
    ignore_component_names: Vec<Box<[u8]>>,
    /// `None`: [`Rule::validate`] has refused the options, and the rule does not run.
    original: Option<Original>,
}

/// What upstream reads otherwise than oxlint.
struct Original {
    /// Whatever is truthy is `true`.
    check_inline_function: bool,
    check_local: bool,
    event_handler_prefix: Vec<u8>,
    event_handler_prop_prefix: Vec<u8>,
    /// `None`: a prefix is `false`, or both are plain names, which the lists of oxlint have as they are.
    regexes: Option<Regexes>,
    ignore_component_names: Vec<Pattern>,
}

struct Regexes {
    event_handler: Regex,
    prop_event_handler: Regex,
}

/// What has been looked up in the text of the file.
#[derive(Default)]
pub struct Known {
    /// Each `.` that the name of a handler follows, and the end of what makes it such a name.
    dots: OnceCell<Vec<(u32, u32)>>,
    /// Each `:` that a `:` follows, and the end of that.
    colons: OnceCell<Vec<(u32, u32)>>,
    /// Whether `EVENT_HANDLER_REGEX` matches all of it.
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
    /// All that is in the braces, which is a name once [`normalize_handler_name`] has been through it.
    Text(Span),
}

impl Rule for JsxHandlerNames {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-handler-names", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = Known;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        // `"a|b"`, or `false` for none.
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
            original: Original::new(options).ok(),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        Original::new(options.object(0)).map(|_| ()).map_err(|error| error.message.into_bytes())
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Known> {
        // Without the one there is neither.
        let has_prefixes = !self.event_handler_prop_prefixes.is_empty();
        let has_regexes = self.original.as_ref()?.regexes.is_some();
        (has_prefixes || (!file.language().is_oxlint && has_regexes)).then(Known::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}

impl Original {
    /// The error is what `new RegExp(..)` throws.
    fn new(options: Object) -> Result<Original, SyntaxError> {
        // `isPrefixDisabled(prefix) ? null : prefix || default`, which then stands in a template.
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
            let of_props = event_handler_prop_prefix.as_deref().unwrap_or_default();
            let event_handler = (event_handler_prefix.as_deref())
                .map(|it| regex(&[b"^((props\\.", of_props, b")|((.*\\.)?", it, b"))[0-9]*[A-Z].*$"]))
                .transpose()?;
            let prop_event_handler =
                event_handler_prop_prefix.as_deref().map(|it| regex(&[b"^(", it, b"[A-Z].*|ref)$"])).transpose()?;
            regexes = event_handler
                .zip(prop_event_handler)
                .map(|(event_handler, prop_event_handler)| Regexes { event_handler, prop_event_handler });
        }
        Ok(Original {
            check_inline_function: options.get("checkInlineFunction").is_some_and(Json::is_truthy),
            check_local: options.get("checkLocalVariables").is_some_and(Json::is_truthy),
            event_handler_prefix: event_handler_prefix.unwrap_or_default(),
            event_handler_prop_prefix: event_handler_prop_prefix.unwrap_or_default(),
            regexes,
            ignore_component_names: options
                .strings("ignoreComponentNames")
                .into_iter()
                .map(|it| Pattern::new(it.as_bytes(), GlobOptions::MINIMATCH_3))
                .collect(),
        })
    }

    /// What the text is taken of that is the name of the handler. `None`: it is not looked at.
    fn handler(&self, expression: Expr) -> Option<Span> {
        // Whether it has an `object`.
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
        // The text of no node is that of the file.
        Some(callee.map_or_else(|| expression.file().span(), Expr::span))
    }
}

impl JsxHandlerNames {
    fn check<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(original) = &self.original else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let regexes = original.regexes.as_ref().filter(|_| !is_oxlint);
        let mut is_ignored = None;
        for attribute in jsx.attrs() {
            let Some(AttributeValue::ExpressionContainer(value_expr)) = get_prop_value(attribute) else {
                continue;
            };
            let handler = match is_oxlint {
                true => self.handler(value_expr),
                // For upstream the name is the text of a node, whatever that is.
                false => original.handler(value_expr).map(|span| (HandlerName::Text(span), span, false)),
            };
            let Some((handler_name, handler_span, is_props_handler)) = handler else {
                continue;
            };
            let Some(key) = attribute.key() else {
                continue;
            };
            let name = key.name().map(Name::bytes).unwrap_or_default();
            let prop_key = match strings::split_once_char(name, b':') {
                // Of `a:b` it is `b`.
                Some((_, local)) if is_oxlint => local,
                // upstream has the node that the `b` is, of which it makes a string.
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
                // What is passed on from the props can have the name of a prop.
                HandlerName::Name(name) if is_props_handler && self.match_event_handler_props_name(name) => Some(true),
                HandlerName::Name(name) => self.match_event_handler_name(name),
                HandlerName::Text(span) => match regexes {
                    Some(regexes) => {
                        let test = || regexes.event_handler.test(&normalize_handler_name(cx.slice(span), is_oxlint));
                        // That of the file is the name in each arrow function that is no call.
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
            // upstream reports the attribute, and says what is the help of oxlint.
            if !is_oxlint {
                match prop_is_event_handler {
                    true => cx
                        .report(attribute.span(), BAD_HANDLER_NAME)
                        .data("propKey", prop_key)
                        .data("handlerPrefix", original.event_handler_prefix.clone()),
                    false => cx
                        .report(attribute.span(), BAD_PROP_KEY)
                        .data("propValue", normalize_handler_name(cx.slice(handler_span), is_oxlint))
                        .data("handlerPropPrefix", original.event_handler_prop_prefix.clone()),
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

    /// The name of the handler if it has one, where it is, and whether it is `props.name` or `this.props.name`. `None`:
    /// it is not looked at.
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
            // All that is in the braces is the name, which is a bad one.
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

    /// `/^((.*\.)?(handle))[0-9]*[A-Z].*$/`. `None`: no name is asked for.
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

    /// [`JsxHandlerNames::match_event_handler_name`] of [`normalize_handler_name`] of the text in `span`, which is not
    /// made: attributes can be in each other, with much at the bottom.
    fn match_event_handler_name_in(&self, span: Span, cx: &Cx<Self>) -> Option<bool> {
        if self.event_handler_prefixes.is_empty() {
            return None;
        }
        let (text, is_oxlint) = (cx.file().text(), cx.language().is_oxlint);
        let start = match is_oxlint {
            true => span.start + if cx.slice(span).starts_with(b"this.") { 5 } else { 0 },
            // upstream takes the blanks out first, and where there is no `this.` all up to the last `::`.
            false => end_of_literal(text, span.start, b"this.", is_oxlint)
                .filter(|end| *end <= span.end)
                .or_else(|| self.last_followed(b':', span, cx))
                .unwrap_or(span.start),
        };
        let is_name_at = |prefixes: &[Box<[u8]>], at: u32| {
            end_of_handler_name_start(prefixes, text, at, is_oxlint).is_some_and(|end| end <= span.end)
        };
        // For upstream `props.onChange` is such a name, whatever follows.
        let is_of_props = || {
            end_of_literal(text, start, b"props.", is_oxlint)
                .is_some_and(|at| is_name_at(&self.event_handler_prop_prefixes, at))
        };
        Some(
            is_name_at(&self.event_handler_prefixes, start)
                || (!is_oxlint && is_of_props())
                || self.last_followed(b'.', Span::new(start, span.end), cx).is_some(),
        )
    }

    /// Of what [`JsxHandlerNames::for_each_followed`] finds for `byte`, where the last ends that is all in `within`.
    fn last_followed(&self, byte: u8, within: Span, cx: &Cx<Self>) -> Option<u32> {
        if within.len() <= 256 {
            let mut last = None;
            self.for_each_followed(byte, within, cx.file(), &mut |_, end| {
                if end <= within.end {
                    last = Some(end);
                }
            });
            return last;
        }
        let all = if byte == b'.' { &cx.state.dots } else { &cx.state.colons }.get_or_init(|| {
            let mut all = Vec::new();
            self.for_each_followed(byte, cx.file().span(), cx.file(), &mut |at, end| all.push((at, end)));
            all
        });
        let first = all.partition_point(|it| it.0 < within.start);
        let inside = all.get(first..all.partition_point(|it| it.0 < within.end))?;
        inside.iter().rev().find(|it| it.1 <= within.end).map(|it| it.1)
    }

    /// Calls `visit` with each `.` in `within` that the name of a handler follows, or each `:` that a `:` follows, and
    /// with where that is known.
    fn for_each_followed(&self, byte: u8, within: Span, file: &File, visit: &mut dyn FnMut(u32, u32)) {
        let (text, is_oxlint) = (file.text(), file.language().is_oxlint);
        let (mut at, end) = (within.start as usize, within.end as usize);
        while let Some(found) = text.get(at..end).and_then(|rest| strings::index_of_char_usize(rest, byte)) {
            at += found + 1;
            let end_of_it = match byte {
                b'.' => end_of_handler_name_start(&self.event_handler_prefixes, text, at as u32, is_oxlint),
                _ => end_of_literal(text, at as u32, b":", is_oxlint),
            };
            if let Some(end_of_it) = end_of_it {
                visit(at as u32 - 1, end_of_it);
            }
        }
    }

    /// The name that is compared is `a.c.d` for `<a.b.c.d>`, as in oxlint.
    fn is_ignored_component(&self, jsx: Jsx, is_oxlint: bool) -> bool {
        // upstream asks minimatch, which throws for what it has of `<a.b>` and `<a:b>`.
        if !is_oxlint {
            let name = get_jsx_element_name(jsx);
            let mut ignored = self.original.iter().flat_map(|it| &it.ignore_component_names);
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

/// The first character of `text` from `at` on that is no blank, and where it ends.
fn next_character(text: &[u8], at: u32, is_oxlint: bool) -> Option<(&[u8], u32)> {
    let mut at = at as usize;
    loop {
        let (c, size) = strings::wtf8_codepoint_at(text, at);
        let character = text.get(at..at + size).filter(|it| !it.is_empty())?;
        at += size;
        // oxlint goes by `White_Space` of Unicode, upstream by `\s`.
        let is_blank = match is_oxlint {
            true => char::from_u32(c).is_some_and(char::is_whitespace),
            false => strings::is_js_whitespace(c),
        };
        if !is_blank {
            return Some((character, at as u32));
        }
    }
}

/// Where `literal` ends in the text from `from`, in which blanks do not count.
fn end_of_literal(text: &[u8], from: u32, literal: &[u8], is_oxlint: bool) -> Option<u32> {
    let (mut at, mut rest) = (from, literal);
    while !rest.is_empty() {
        let (character, end) = next_character(text, at, is_oxlint)?;
        rest = rest.strip_prefix(character)?;
        at = end;
    }
    Some(at)
}

/// Where the capital letter of `/^(handle)[0-9]*[A-Z]/` ends in the text from `from`, in which blanks do not count.
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

/// The name, and whether it is of `props` or `this.props`.
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

/// Without `this.` at the start and without blanks.
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
