use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::{AttributeValue, StringLiteral, get_prop_value};
use crate::react::{form_components, get_component_attrs_by_name, is_jsx, link_components};
use crate::util_link_components::{get_form_component, get_link_component};
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;

/// Disallow `target="_blank"` attribute without `rel="noreferrer"`
pub struct JsxNoTargetBlank {
    enforce_dynamic_links: bool,
    warn_on_spread_attributes: bool,
    allow_referrer: bool,
    links: bool,
    forms: bool,
}

const NO_TARGET_BLANK_WITHOUT_NOREFERRER: Message = Message::new(
    "noTargetBlankWithoutNoreferrer",
    "Using target=\"_blank\" without rel=\"noreferrer\" (which implies rel=\"noopener\") is a security risk in older browsers: see https://mathiasbynens.github.io/rel-noopener/#recommendations",
);
const NO_TARGET_BLANK_WITHOUT_NOOPENER: Message = Message::new(
    "noTargetBlankWithoutNoopener",
    "Using target=\"_blank\" without rel=\"noreferrer\" or rel=\"noopener\" (the former implies the latter and is preferred due to wider support) is a security risk: see https://mathiasbynens.github.io/rel-noopener/#recommendations",
);
const TARGET_BLANK_WITHOUT_NOREFERRER: Message = Message::new(
    "",
    "Using target=`_blank` without rel=`noreferrer` (which implies rel=`noopener`) is a security risk in older browsers: see https://mathiasbynens.github.io/rel-noopener/#recommendations",
);
const TARGET_BLANK_WITHOUT_NOOPENER: Message = Message::new(
    "",
    "Using target=`_blank` without rel=`noreferrer` or rel=`noopener` (the former implies the latter and is preferred due to wider support) is a security risk: see https://mathiasbynens.github.io/rel-noopener/#recommendations",
);
const EXPLICIT_PROPS_IN_SPREAD_ATTRIBUTES: Message = Message::new(
    "",
    "all spread attributes are treated as if they contain an unsafe combination of props, unless specifically overridden by props after the last spread attribute prop.",
);
const ADD_NOREFERRER: Message = Message::new("", "add rel=`noreferrer` to the element");
const ADD_NOREFERRER_OR_NOOPENER: Message = Message::new("", "add rel=`noreferrer` or rel=`noopener` to the element");

/// `settings.react.linkComponents` and `formComponents`, where oxlint has them.
pub struct State<'a> {
    link_components: &'a [Json],
    form_components: &'a [Json],
}

/// What is known of the value of `target` or `rel`.
#[derive(Copy, Clone, Default)]
struct Checked<'a> {
    /// `target` can be `_blank`. `rel` is always safe.
    holds: bool,
    /// Of `test ? consequent : alternate`
    test: Option<Expr<'a>>,
    holds_in_consequent: bool,
    holds_in_alternate: bool,
}

/// What is known of the attribute with the URL.
#[derive(Copy, Clone, Default)]
struct Href {
    is_external_link: bool,
    is_dynamic_link: bool,
}

/// What an element is checked as.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Component {
    Link,
    Form,
}

impl Rule for JsxNoTargetBlank {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-target-blank", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxNoTargetBlank {
            enforce_dynamic_links: options.str("enforceDynamicLinks") != Some("never"),
            warn_on_spread_attributes: options.bool_or("warnOnSpreadAttributes", false),
            allow_referrer: options.bool_or("allowReferrer", false),
            links: options.bool_or("links", true),
            forms: options.bool_or("forms", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if (file.language().is_oxlint && !is_jsx(file))
            || !(self.warn_on_spread_attributes || file.mentions("target"))
        {
            return None;
        }
        Some(State { link_components: link_components(file), form_components: form_components(file) })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        if jsx.attrs().is_empty() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let tag_name = match jsx.tag().map(Expr::tag) {
            // oxlint has no name for it.
            Some(ExprTag::This) if !is_oxlint => Some(b"this".as_slice()),
            _ => get_identifier_name(jsx).map(Name::bytes),
        };
        let Some(tag_name) = tag_name else {
            return;
        };
        // Upstream checks a link by its attributes, then a form by its own, and knows no `links`.
        if !is_oxlint {
            if let Some(attributes) = get_link_component(cx.file(), tag_name) {
                self.check(jsx, Component::Link, &|name| attributes.contains(&name), cx);
            }
            if self.forms && let Some(attributes) = get_form_component(cx.file(), tag_name) {
                self.check(jsx, Component::Form, &|name| attributes.contains(&name), cx);
            }
            return;
        }
        let link_attributes = get_component_attrs_by_name(cx.state.link_components, tag_name);
        let form_attributes = get_component_attrs_by_name(cx.state.form_components, tag_name);
        let is_link = self.links && (tag_name == b"a" || link_attributes.is_some());
        let is_form = self.forms && (tag_name == b"form" || form_attributes.is_some());
        if !is_link && !is_form {
            return;
        }
        let has_url = |name: &[u8]| {
            name != b"target"
                && (matches!(name, b"href" | b"action")
                    || link_attributes.is_some_and(|it| it.contains(name))
                    || form_attributes.is_some_and(|it| it.contains(name)))
        };
        self.check(jsx, if is_link { Component::Link } else { Component::Form }, &has_url, cx);
    }
}

impl JsxNoTargetBlank {
    /// `has_url`: whether an attribute of that name has the URL.
    fn check<'a>(&self, jsx: Jsx<'a>, component: Component, has_url: &dyn Fn(&[u8]) -> bool, cx: &Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // Upstream checks a form as if neither option were given.
        let is_as_configured = is_oxlint || component == Component::Link;
        let allow_referrer = self.allow_referrer && is_as_configured;
        // `toLowerCase`, where oxlint knows the letters of ASCII.
        let is_blank = |it: &[u8]| match is_oxlint {
            true => it.eq_ignore_ascii_case(b"_blank"),
            false => *text::to_lower_case(it) == *b"_blank",
        };
        let (mut target_blank, mut rel_valid, mut href) = (Checked::default(), Checked::default(), Href::default());
        let (mut target, mut spread_span) = (None, None);
        for attribute in jsx.attrs() {
            if attribute.kind() == PropKind::Spread {
                if self.warn_on_spread_attributes {
                    spread_span = Some(attribute.span());
                    if is_as_configured {
                        rel_valid = Checked::default();
                        href = Href { is_external_link: true, is_dynamic_link: href.is_dynamic_link && !is_oxlint };
                    }
                }
                continue;
            }
            let Some(name) = attribute.key().and_then(Key::name).map(Name::bytes) else {
                continue;
            };
            // A name with a namespace is none of these. oxlint passes over an attribute without a value.
            if strings::contains_char(name, b':') || (is_oxlint && get_prop_value(attribute).is_none()) {
                continue;
            }
            let is_url = has_url(name);
            if name == b"target" {
                target_blank = check_value(attribute, false, is_oxlint, &is_blank);
                target = Some(attribute);
            }
            if is_url {
                // For upstream one dynamic link is enough, wherever it is.
                let is_dynamic_link = href.is_dynamic_link && !is_oxlint;
                href = check_href(attribute, is_oxlint);
                href.is_dynamic_link |= is_dynamic_link;
            }
            // For oxlint it is the one or the other.
            if name == b"rel" && !(is_oxlint && is_url) {
                rel_valid = check_value(attribute, true, is_oxlint, &|it| check_rel_val(it, allow_referrer, is_oxlint));
            }
        }
        let is_href_valid = match self.enforce_dynamic_links {
            true => !(href.is_external_link || href.is_dynamic_link),
            false => !href.is_external_link || (is_oxlint && href.is_dynamic_link),
        };
        if is_href_valid {
            return;
        }
        // oxlint looks at no `target` then, and has a message for it.
        if is_oxlint && let Some(spread_span) = spread_span {
            if !rel_valid.holds {
                self.report(spread_span, EXPLICIT_PROPS_IN_SPREAD_ATTRIBUTES, ADD_NOREFERRER, jsx, component, cx);
            }
            return;
        }
        if !target_blank.holds && spread_span.is_none() {
            return;
        }
        let is_rel_valid = match (target_blank.test, rel_valid.test, target) {
            (Some(target_test), Some(rel_test), Some(target)) if is_same_test(target_test, rel_test, is_oxlint) => {
                // Upstream looks at the first that is `"_blank"` as it is written here.
                let exactly = check_value(target, false, is_oxlint, &|it| it == b"_blank");
                match is_oxlint {
                    true => {
                        (!target_blank.holds_in_consequent || rel_valid.holds_in_consequent)
                            && (!target_blank.holds_in_alternate || rel_valid.holds_in_alternate)
                    }
                    false if exactly.holds_in_consequent => rel_valid.holds_in_consequent,
                    false => exactly.holds_in_alternate && rel_valid.holds_in_alternate,
                }
            }
            _ => rel_valid.holds,
        };
        if is_rel_valid {
            return;
        }
        let (message, of_oxlint, help) = match self.allow_referrer {
            true => (NO_TARGET_BLANK_WITHOUT_NOOPENER, TARGET_BLANK_WITHOUT_NOOPENER, ADD_NOREFERRER_OR_NOOPENER),
            false => (NO_TARGET_BLANK_WITHOUT_NOREFERRER, TARGET_BLANK_WITHOUT_NOREFERRER, ADD_NOREFERRER),
        };
        // oxlint points at the value of `target`.
        match target.and_then(get_prop_value) {
            Some(value) if is_oxlint => self.report(value.span(), of_oxlint, help, jsx, component, cx),
            _ => self.report(jsx.opening_span(), if is_oxlint { of_oxlint } else { message }, help, jsx, component, cx),
        }
    }

    fn report<'a>(
        &self,
        span: Span,
        message: Message,
        help: Message,
        jsx: Jsx<'a>,
        component: Component,
        cx: &Cx<'a, Self>,
    ) {
        let report = cx.report(span, message);
        if component == Component::Link {
            // oxlint suggests what upstream fixes.
            match cx.language().is_oxlint {
                true => report.suggest(help, |fixer| self.add_secure_rel(jsx, fixer)),
                false => report.fix(|fixer| self.add_secure_rel(jsx, fixer)),
            };
        }
    }

    fn add_secure_rel<'a>(&self, jsx: Jsx<'a>, fixer: Fixer<'a>) -> Option<Fix> {
        let is_oxlint = fixer.file().language().is_oxlint;
        // The last of each, but for upstream the first `rel`.
        let (mut target_index, mut spread_index, mut rel_attribute) = (None, None, None);
        for (index, attribute) in jsx.attrs().iter().enumerate() {
            if attribute.kind() == PropKind::Spread {
                spread_index = Some(index);
            } else if attribute.key().is_some_and(|key| key.is("target")) {
                target_index = Some(index);
            } else if attribute.key().is_some_and(|key| key.is("rel")) && (is_oxlint || rel_attribute.is_none()) {
                rel_attribute = Some(attribute);
            }
        }
        if let Some(spread_index) = spread_index
            && (rel_attribute.is_none() || target_index.is_none_or(|it| it < spread_index))
        {
            return None;
        }
        let rel_value = if self.allow_referrer { "noopener" } else { "noreferrer" };
        let Some(rel_attribute) = rel_attribute else {
            return Some(fixer.insert_after(jsx.attrs().last()?, format!(" rel=\"{rel_value}\"")));
        };
        match get_prop_value(rel_attribute) {
            None => Some(fixer.insert_after(rel_attribute, format!("=\"{rel_value}\""))),
            Some(AttributeValue::StringLiteral(literal)) => {
                Some(fixer.replace(literal.span, append_noreferrer(rel_attribute.value()?, is_oxlint)))
            }
            // oxlint looks at nothing in parentheses.
            Some(AttributeValue::ExpressionContainer(e)) if !(is_oxlint && e.is_parenthesized()) => match e.tag() {
                ExprTag::String => Some(fixer.replace(e, append_noreferrer(e, is_oxlint))),
                ExprTag::True
                | ExprTag::False
                | ExprTag::Null
                | ExprTag::Number
                | ExprTag::BigInt
                | ExprTag::Regex => Some(fixer.replace(e.jsx_container_span()?, "\"noreferrer\"")),
                _ => None,
            },
            _ => None,
        }
    }
}

/// `string`: a string literal. oxlint keeps its quotes, and what is between them as it is written.
fn append_noreferrer(string: Expr<'_>, is_oxlint: bool) -> Vec<u8> {
    let raw = string.text();
    let (quote, content) = match string.as_string() {
        Some(value) if !is_oxlint => (&b"\""[..], value.bytes()),
        _ => (raw.get(..1).unwrap_or_default(), raw.get(1..raw.len().saturating_sub(1)).unwrap_or_default()),
    };
    let mut parts: SmallVec<[&[u8]; 4]> = strings::split(content, b"noreferrer").filter(|it| !it.is_empty()).collect();
    parts.push(b"noreferrer");
    [quote, &parts.join(&b" "[..]), quote].concat()
}

/// Whether `target` and `rel` depend on the same. For upstream that is a variable of one name, or no variable in both.
fn is_same_test<'a>(target_test: Expr<'a>, rel_test: Expr<'a>, is_oxlint: bool) -> bool {
    if !is_oxlint {
        return target_test.as_ident() == rel_test.as_ident();
    }
    !target_test.is_parenthesized() && !rel_test.is_parenthesized() && is_same_expression(target_test, rel_test)
}

/// Calls `visit` with the `a`, `b` and `c` of `x ? a : y ? b : c`, in this order. What is in parentheses is not looked
/// into. For upstream it is `expr` alone.
fn for_each_branch<'a>(expr: Expr<'a>, is_oxlint: bool, mut visit: impl FnMut(Expr<'a>)) {
    let mut pending: SmallVec<[Expr<'a>; 4]> = smallvec![expr];
    while let Some(expr) = pending.pop() {
        match expr.kind() {
            ExprKind::Cond { yes, no, .. } if is_oxlint && !expr.is_parenthesized() => pending.extend([no, yes]),
            _ => visit(expr),
        }
    }
}

/// The value, if it is a string, for oxlint one that is not in parentheses.
fn string_literal(expr: Expr<'_>, is_oxlint: bool) -> Option<&[u8]> {
    expr.as_string().filter(|_| !(is_oxlint && expr.is_parenthesized())).map(Name::bytes)
}

/// The `b` of `a="b"`. oxlint reads `&amp;` as it is written.
fn value_of<'a>(attribute: Prop<'a>, literal: StringLiteral<'a>, is_oxlint: bool) -> &'a [u8] {
    attribute.value().and_then(Expr::as_string).filter(|_| !is_oxlint).map_or(literal.value, Name::bytes)
}

/// `check_target` and `check_rel`; upstream's `attributeValuePossiblyBlank` and `getStringFromValue`. `is_rel`: `holds`
/// has to hold for all the strings that it can be, not for one of them.
fn check_value<'a>(attribute: Prop<'a>, is_rel: bool, is_oxlint: bool, holds: &dyn Fn(&[u8]) -> bool) -> Checked<'a> {
    let holds_in = |expr: Expr<'a>| {
        let (mut all, mut any) = (true, false);
        for_each_branch(expr, is_oxlint, |branch| {
            let it_holds = string_literal(branch, is_oxlint).is_some_and(holds);
            (all, any) = (all && it_holds, any || it_holds);
        });
        if is_rel { all } else { any }
    };
    let Some(value) = get_prop_value(attribute) else {
        return Checked::default();
    };
    if let AttributeValue::StringLiteral(literal) = value {
        return Checked { holds: holds(value_of(attribute, literal, is_oxlint)), ..Checked::default() };
    }
    let Some(expr) = value.as_expression() else {
        return Checked::default();
    };
    match expr.kind() {
        ExprKind::Cond { test, yes, no } if !(is_oxlint && expr.is_parenthesized()) => {
            let (holds_in_consequent, holds_in_alternate) = (holds_in(yes), holds_in(no));
            let holds = match is_rel {
                true => holds_in_consequent && holds_in_alternate,
                false => holds_in_consequent || holds_in_alternate,
            };
            Checked { holds, test: Some(test), holds_in_consequent, holds_in_alternate }
        }
        // Upstream reads a template up to its first substitution.
        ExprKind::Template(template) if is_rel && !is_oxlint => {
            Checked { holds: template.cooked(0).is_some_and(|it| holds(it.bytes())), ..Checked::default() }
        }
        _ => Checked { holds: holds_in(expr), ..Checked::default() },
    }
}

/// Upstream's is `/^(?:\w+:|\/\/)/`.
fn check_is_external_link(link: &[u8], is_oxlint: bool) -> bool {
    if is_oxlint {
        return strings::contains(link, b"//");
    }
    let word = link.iter().take_while(|it| it.is_ascii_alphanumeric() || matches!(it, b'_')).count();
    link.starts_with(b"//") || (word > 0 && link.get(word) == Some(&b':'))
}

fn check_href(attribute: Prop, is_oxlint: bool) -> Href {
    let mut href = Href::default();
    match get_prop_value(attribute) {
        Some(AttributeValue::StringLiteral(literal)) => {
            href.is_external_link = check_is_external_link(value_of(attribute, literal, is_oxlint), is_oxlint);
        }
        // For upstream all that is in braces is dynamic.
        Some(AttributeValue::ExpressionContainer(_)) if !is_oxlint => href.is_dynamic_link = true,
        value => {
            if let Some(expr) = value.and_then(AttributeValue::as_expression) {
                // The last string counts.
                for_each_branch(expr, is_oxlint, |branch| match string_literal(branch, is_oxlint) {
                    Some(link) => href.is_external_link = check_is_external_link(link, is_oxlint),
                    None => href.is_dynamic_link |= branch.tag() == ExprTag::Ident && !branch.is_parenthesized(),
                });
            }
        }
    }
    href
}

/// With `allowReferrer` oxlint wants small letters.
fn check_rel_val(value: &[u8], allow_referrer: bool, is_oxlint: bool) -> bool {
    let value = if is_oxlint && allow_referrer { Cow::Borrowed(value) } else { text::to_lower_case(value) };
    strings::split(&value, b" ").any(|it| it == b"noreferrer" || (allow_referrer && it == b"noopener"))
}
