use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::{form_components, get_component_attrs_by_name, is_jsx, link_components};
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// This rule aims to prevent user-generated link hrefs and form actions from creating security vulnerabilities.
pub struct JsxNoTargetBlank {
    enforce_dynamic_links: bool,
    warn_on_spread_attributes: bool,
    allow_referrer: bool,
    links: bool,
    forms: bool,
}

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

impl Rule for JsxNoTargetBlank {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-target-blank", Kind::Suggestion).has_suggestions();
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_jsx(file) {
            on.exprs([ExprTag::Jsx], check);
        }
        State { link_components: link_components(file), form_components: form_components(file) }
    }
}

fn check<'a>(rule: &JsxNoTargetBlank, e: Expr<'a>, cx: &mut Cx<'a, JsxNoTargetBlank>) {
    let ExprKind::Jsx(jsx) = e.kind() else {
        return;
    };
    let Some(tag_name) = get_identifier_name(jsx).map(Name::bytes) else {
        return;
    };
    let link_attributes = get_component_attrs_by_name(cx.state.link_components, tag_name);
    let form_attributes = get_component_attrs_by_name(cx.state.form_components, tag_name);
    let is_link = rule.links && (tag_name == b"a" || link_attributes.is_some());
    let is_form = rule.forms && (tag_name == b"form" || form_attributes.is_some());
    if !is_link && !is_form {
        return;
    }
    let (mut target_blank, mut rel_valid) = (Checked::default(), Checked::default());
    let (mut is_href_valid, mut has_href_value) = (true, false);
    let (mut target_span, mut spread_span) = (None, None);
    for attribute in jsx.attrs() {
        if attribute.kind() == PropKind::Spread {
            if rule.warn_on_spread_attributes {
                spread_span = Some(attribute.span());
                (target_blank, rel_valid) = (Checked::default(), Checked::default());
                (is_href_valid, has_href_value) = (false, true);
            }
            continue;
        }
        let (Some(name), Some(value)) =
            (attribute.key().and_then(Key::name).map(Name::bytes), get_prop_value(attribute))
        else {
            continue;
        };
        // A name with a namespace is none of these.
        if name == b"target" {
            target_blank = check_value(value, false, |text| text.eq_ignore_ascii_case(b"_blank"));
            target_span = Some(value.span());
        } else if matches!(name, b"href" | b"action")
            || link_attributes.is_some_and(|it| it.contains(name))
            || form_attributes.is_some_and(|it| it.contains(name))
        {
            has_href_value = true;
            is_href_valid = check_href(value, rule.enforce_dynamic_links);
        } else if name == b"rel" {
            rel_valid = check_value(value, true, |text| check_rel_val(text, rule.allow_referrer));
        }
    }
    if let Some(spread_span) = spread_span {
        if !(has_href_value && is_href_valid) && !rel_valid.holds {
            rule.report(spread_span, EXPLICIT_PROPS_IN_SPREAD_ATTRIBUTES, ADD_NOREFERRER, jsx, is_link, cx);
        }
        return;
    }
    if is_href_valid {
        return;
    }
    let is_unsafe = match (target_blank.test, rel_valid.test) {
        (Some(target_test), Some(rel_test))
            if !target_test.is_parenthesized()
                && !rel_test.is_parenthesized()
                && is_same_expression(target_test, rel_test) =>
        {
            target_blank.holds_in_consequent && !rel_valid.holds_in_consequent
                || target_blank.holds_in_alternate && !rel_valid.holds_in_alternate
        }
        _ => target_blank.holds && !rel_valid.holds,
    };
    if is_unsafe {
        let (message, help) = match rule.allow_referrer {
            true => (TARGET_BLANK_WITHOUT_NOOPENER, ADD_NOREFERRER_OR_NOOPENER),
            false => (TARGET_BLANK_WITHOUT_NOREFERRER, ADD_NOREFERRER),
        };
        rule.report(target_span.unwrap_or_else(|| jsx.opening_span()), message, help, jsx, is_link, cx);
    }
}

impl JsxNoTargetBlank {
    fn report<'a>(&self, span: Span, message: Message, help: Message, jsx: Jsx<'a>, is_link: bool, cx: &Cx<'a, Self>) {
        let report = cx.report(span, message);
        if is_link {
            report.suggest(help, |fixer| self.add_secure_rel(jsx, fixer));
        }
    }

    fn add_secure_rel<'a>(&self, jsx: Jsx<'a>, fixer: Fixer<'a>) -> Option<Fix> {
        // The last of each.
        let (mut target_index, mut spread_index, mut rel_attribute) = (None, None, None);
        for (index, attribute) in jsx.attrs().iter().enumerate() {
            if attribute.kind() == PropKind::Spread {
                spread_index = Some(index);
            } else if attribute.key().is_some_and(|key| key.is("target")) {
                target_index = Some(index);
            } else if attribute.key().is_some_and(|key| key.is("rel")) {
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
                Some(fixer.replace(literal.span, append_noreferrer(fixer.file().slice(literal.span))))
            }
            Some(AttributeValue::ExpressionContainer(e)) if !e.is_parenthesized() => match e.tag() {
                ExprTag::String => Some(fixer.replace(e, append_noreferrer(e.text()))),
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

/// `raw`: a string with its quotes.
fn append_noreferrer(raw: &[u8]) -> Vec<u8> {
    let quote = raw.get(..1).unwrap_or_default();
    let content = raw.get(1..raw.len().saturating_sub(1)).unwrap_or_default();
    let mut parts: SmallVec<[&[u8]; 4]> = strings::split(content, b"noreferrer").filter(|it| !it.is_empty()).collect();
    parts.push(b"noreferrer");
    [quote, &parts.join(&b" "[..]), quote].concat()
}

/// Calls `visit` with the `a`, `b` and `c` of `x ? a : y ? b : c`, in this order. What is in parentheses is not looked
/// into.
fn for_each_branch<'a>(expr: Expr<'a>, mut visit: impl FnMut(Expr<'a>)) {
    let mut pending: SmallVec<[Expr<'a>; 4]> = smallvec![expr];
    while let Some(expr) = pending.pop() {
        match expr.kind() {
            ExprKind::Cond { yes, no, .. } if !expr.is_parenthesized() => pending.extend([no, yes]),
            _ => visit(expr),
        }
    }
}

/// The value, if it is a string that is not in parentheses.
fn string_literal(expr: Expr<'_>) -> Option<&[u8]> {
    expr.as_string().filter(|_| !expr.is_parenthesized()).map(Name::bytes)
}

/// `check_target` and `check_rel`. `in_all`: `holds` has to hold for all the strings that it can be, not for one of
/// them.
fn check_value<'a>(value: AttributeValue<'a>, in_all: bool, holds: impl Fn(&[u8]) -> bool) -> Checked<'a> {
    let holds_in = |expr: Expr<'a>| {
        let (mut all, mut any) = (true, false);
        for_each_branch(expr, |branch| {
            let holds = string_literal(branch).is_some_and(&holds);
            (all, any) = (all && holds, any || holds);
        });
        if in_all { all } else { any }
    };
    match value {
        AttributeValue::StringLiteral(literal) => Checked { holds: holds(literal.value), ..Checked::default() },
        _ => match value.as_expression() {
            Some(expr) => match expr.kind() {
                ExprKind::Cond { test, yes, no } if !expr.is_parenthesized() => Checked {
                    holds: holds_in(expr),
                    test: Some(test),
                    holds_in_consequent: holds_in(yes),
                    holds_in_alternate: holds_in(no),
                },
                _ => Checked { holds: holds_in(expr), ..Checked::default() },
            },
            None => Checked::default(),
        },
    }
}

fn check_is_external_link(link: &[u8]) -> bool {
    strings::contains(link, b"//")
}

fn check_href(value: AttributeValue, enforce_dynamic_links: bool) -> bool {
    let (mut is_dynamic_link, mut is_external_link) = (false, false);
    match value {
        AttributeValue::StringLiteral(literal) => is_external_link = check_is_external_link(literal.value),
        _ => {
            if let Some(expr) = value.as_expression() {
                // The last string counts.
                for_each_branch(expr, |branch| match string_literal(branch) {
                    Some(link) => is_external_link = check_is_external_link(link),
                    None => is_dynamic_link |= branch.tag() == ExprTag::Ident && !branch.is_parenthesized(),
                });
            }
        }
    }
    match enforce_dynamic_links {
        true => !(is_external_link || is_dynamic_link),
        false => !is_external_link || is_dynamic_link,
    }
}

fn check_rel_val(value: &[u8], allow_referrer: bool) -> bool {
    strings::split(value, b" ").any(|it| match allow_referrer {
        true => matches!(it, b"noopener" | b"noreferrer"),
        false => it.eq_ignore_ascii_case(b"noreferrer"),
    })
}
