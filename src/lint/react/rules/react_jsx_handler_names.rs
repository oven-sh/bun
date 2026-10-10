use crate::jsx::{AttributeValue, get_prop_value};
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Ensures that any component or prop methods used to handle events are correctly prefixed.
pub struct JsxHandlerNames {
    check_inline_functions: bool,
    check_local_variables: bool,
    /// Empty: the names of the props are not looked at.
    event_handler_prop_prefixes: Vec<Box<[u8]>>,
    /// Empty: the names of the handlers are not looked at.
    event_handler_prefixes: Vec<Box<[u8]>>,
    ignore_component_names: Vec<Box<[u8]>>,
}

const BAD_HANDLER_NAME: Message = Message::new("", "Bad handler name");
const INVALID_HANDLER_NAME: Message = Message::new("", "Invalid handler name: {{handler_name}}");
const INVALID_HANDLER_PROP_NAME: Message = Message::new("", "Invalid handler prop name: {{prop_key}}");

#[derive(Copy, Clone)]
enum HandlerName<'a> {
    None,
    Name(&'a [u8]),
    /// All that is in the braces, which is a name once [`normalize_handler_name`] has been through it.
    Text(Span),
}

impl Rule for JsxHandlerNames {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-handler-names", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    /// Where in the file the name of a handler follows a `.`: the `.`, and the end of what makes it such a name.
    type State<'a> = OnceCell<Vec<(u32, u32)>>;

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
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        // Without the one there is neither.
        (!self.event_handler_prop_prefixes.is_empty()).then(OnceCell::new)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}

impl JsxHandlerNames {
    fn check<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let mut is_ignored = None;
        for attribute in jsx.attrs() {
            let Some(AttributeValue::ExpressionContainer(value_expr)) = get_prop_value(attribute) else {
                continue;
            };
            let Some((handler_name, handler_span, is_props_handler)) = self.handler(value_expr) else {
                continue;
            };
            let Some(key) = attribute.key() else {
                continue;
            };
            // Of `a:b` it is `b`.
            let name = key.name().map(Name::bytes).unwrap_or_default();
            let prop_key = strings::split_once_char(name, b':').map_or(name, |it| it.1);
            // Any function can be a `ref`.
            if prop_key == b"ref" {
                continue;
            }
            let prop_is_event_handler = self.match_event_handler_props_name(prop_key);
            let is_handler_name_correct = match handler_name {
                HandlerName::None => Some(false),
                // What is passed on from the props can have the name of a prop.
                HandlerName::Name(name) if is_props_handler && self.match_event_handler_props_name(name) => Some(true),
                HandlerName::Name(name) => self.match_event_handler_name(name),
                HandlerName::Text(span) => self.match_event_handler_name_in(span, cx),
            };
            if is_handler_name_correct != Some(!prop_is_event_handler)
                || *is_ignored.get_or_insert_with(|| self.is_ignored_component(jsx))
            {
                continue;
            }
            let report = match (prop_is_event_handler, handler_name) {
                (true, HandlerName::Name(name)) => {
                    cx.report(handler_span, INVALID_HANDLER_NAME).data("handler_name", name)
                }
                (true, HandlerName::Text(span)) => cx
                    .report(handler_span, INVALID_HANDLER_NAME)
                    .data("handler_name", normalize_handler_name(cx.slice(span))),
                (true, HandlerName::None) => cx.report(handler_span, BAD_HANDLER_NAME),
                (false, _) => cx.report(key.span(cx.file()), INVALID_HANDLER_PROP_NAME).data("prop_key", prop_key),
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
                    HandlerName::Text(span) => format!(" for {}", text(&normalize_handler_name(cx.slice(span)))),
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
        let text = cx.file().text();
        let start = span.start + if cx.slice(span).starts_with(b"this.") { 5 } else { 0 };
        if self.end_of_handler_name_start(text, start as usize).is_some_and(|end| end <= span.end) {
            return Some(true);
        }
        if span.len() <= 256 {
            let mut is_found = false;
            let within = Span::new(start, span.end);
            self.for_each_handler_name_after_a_dot(text, within, |_, end| is_found |= end <= span.end);
            return Some(is_found);
        }
        let all = cx.state.get_or_init(|| {
            let mut all = Vec::new();
            self.for_each_handler_name_after_a_dot(text, cx.file().span(), |dot, end| all.push((dot, end)));
            all
        });
        let from_start = all.get(all.partition_point(|it| it.0 < start)..).unwrap_or_default();
        Some(from_start.iter().take_while(|it| it.0 < span.end).any(|it| it.1 <= span.end))
    }

    /// Calls `visit` with each `.` in `within` that the name of a handler follows, and with where that is known.
    fn for_each_handler_name_after_a_dot(&self, text: &[u8], within: Span, mut visit: impl FnMut(u32, u32)) {
        let (mut at, end) = (within.start as usize, within.end as usize);
        while let Some(found) = text.get(at..end).and_then(|rest| strings::index_of_char_usize(rest, b'.')) {
            at += found + 1;
            if let Some(end) = self.end_of_handler_name_start(text, at) {
                visit(at as u32 - 1, end);
            }
        }
    }

    /// Where the capital letter of `/^(handle)[0-9]*[A-Z]/` ends in the text from `from`, in which blanks do not count.
    fn end_of_handler_name_start(&self, text: &[u8], from: usize) -> Option<u32> {
        let end_with = |prefix: &[u8]| {
            let (mut at, mut prefix) = (from, prefix);
            loop {
                let (c, size) = strings::wtf8_codepoint_at(text, at);
                let character = text.get(at..at + size).filter(|it| !it.is_empty())?;
                at += size;
                if char::from_u32(c).is_some_and(char::is_whitespace) {
                    continue;
                }
                if !prefix.is_empty() {
                    prefix = prefix.strip_prefix(character)?;
                } else if !character.iter().all(u8::is_ascii_digit) {
                    return starts_with_upper(character).then_some(at as u32);
                }
            }
        };
        self.event_handler_prefixes.iter().filter_map(|it| end_with(it)).min()
    }

    /// The name that is compared is `a.c.d` for `<a.b.c.d>`, as in oxlint.
    fn is_ignored_component(&self, jsx: Jsx) -> bool {
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
fn normalize_handler_name(s: &[u8]) -> Vec<u8> {
    let s = s.strip_prefix(b"this.").unwrap_or(s);
    match std::str::from_utf8(s) {
        Ok(s) => s.chars().filter(|c| !c.is_whitespace()).collect::<String>().into_bytes(),
        Err(_) => s.iter().copied().filter(|c| !c.is_ascii_whitespace()).collect(),
    }
}
