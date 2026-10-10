use crate::jsx::get_jsx_attribute_name;
use crate::util_jsx::is_dom_component;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;
use std::cmp::Ordering;

/// Enforce props alphabetical sorting
pub struct JsxSortProps {
    ignore_case: bool,
    callbacks_last: bool,
    shorthand_first: bool,
    shorthand_last: bool,
    multiline: Multiline,
    no_sort_alphabetically: bool,
    reserved_first: ReservedFirst,
    /// `locale` is not `"auto"`.
    has_locale: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Multiline {
    Ignore,
    First,
    Last,
}

enum ReservedFirst {
    No,
    List(ReservedList),
    /// What `validateReservedFirstConfig` finds. `None`: the list is empty. Else `unreservedWords`.
    Error(Option<Vec<u8>>),
}

/// Which of `RESERVED_PROPS_LIST`.
#[derive(Copy, Clone)]
struct ReservedList([bool; 4]);

const RESERVED_PROPS_LIST: [&str; 4] = ["children", "dangerouslySetInnerHTML", "key", "ref"];

const NO_UNRESERVED_PROPS: Message = Message::new(
    "noUnreservedProps",
    "A customized reserved first list must only contain a subset of React reserved props. Remove: {{unreservedWords}}",
);
const LIST_IS_EMPTY: Message = Message::new("listIsEmpty", "A customized reserved first list must not be empty");
const LIST_RESERVED_PROPS_FIRST: Message =
    Message::new("listReservedPropsFirst", "Reserved props must be listed before all other props");
const LIST_CALLBACKS_LAST: Message =
    Message::new("listCallbacksLast", "Callbacks must be listed after all other props");
const LIST_SHORTHAND_FIRST: Message =
    Message::new("listShorthandFirst", "Shorthand props must be listed before all other props");
const LIST_SHORTHAND_LAST: Message =
    Message::new("listShorthandLast", "Shorthand props must be listed after all other props");
const LIST_MULTILINE_FIRST: Message =
    Message::new("listMultilineFirst", "Multiline props must be listed before all other props");
const LIST_MULTILINE_LAST: Message =
    Message::new("listMultilineLast", "Multiline props must be listed after all other props");
const SORT_PROPS_BY_ALPHA: Message = Message::new("sortPropsByAlpha", "Props should be sorted alphabetically");

/// `memo` or `decl` of the walk over the attributes.
struct Attribute<'a> {
    decl: Prop<'a>,
    /// In lower case with `ignoreCase`.
    name: Cow<'a, [u8]>,
    is_callback: bool,
    /// `reportedNodeAttributes`: the ids of what is reported at it.
    reported: SmallVec<[&'static str; 3]>,
}

/// What the walk makes of `memo` and `decl`.
enum Found {
    /// `return decl`
    InOrder,
    /// Reported at `decl`.
    Current(Message),
    /// Reported at `memo`.
    Previous(Message),
}

/// What all reports in one element have in common.
struct Element<'a, 'r> {
    rule: &'r JsxSortProps,
    attributes: List<'a, Prop<'a>>,
    reserved_list: Option<ReservedList>,
    fix: OnceCell<Fix>,
}

/// An attribute in a group of `getGroupsOfSortableAttributes`.
struct Sortable<'a> {
    /// From its start to `attributeMap.get(attribute).end`: a comment, and the attribute after that, can move with it.
    span: Span,
    group: u32,
    /// What `contextCompare` looks at before the names, in that order: `false` comes first.
    rank: [bool; 5],
    /// In lower case with `ignoreCase`.
    name: Cow<'a, [u8]>,
}

impl Rule for JsxSortProps {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-sort-props", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let configuration = options.object(0);
        JsxSortProps {
            ignore_case: configuration.bool_or("ignoreCase", false),
            callbacks_last: configuration.bool_or("callbacksLast", false),
            shorthand_first: configuration.bool_or("shorthandFirst", false),
            shorthand_last: configuration.bool_or("shorthandLast", false),
            multiline: match configuration.str("multiline") {
                Some("first") => Multiline::First,
                Some("last") => Multiline::Last,
                _ => Multiline::Ignore,
            },
            no_sort_alphabetically: configuration.bool_or("noSortAlphabetically", false),
            reserved_first: ReservedFirst::new(configuration.get("reservedFirst")),
            has_locale: configuration.str("locale").is_some_and(|it| !it.is_empty() && it != "auto"),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let attributes = jsx.attrs();
        if let ReservedFirst::Error(unreserved_words) = &self.reserved_first {
            for decl in attributes.iter().filter(|it| it.kind() != PropKind::Spread) {
                match unreserved_words {
                    Some(words) => cx.report(decl, NO_UNRESERVED_PROPS).data("unreservedWords", words.clone()),
                    None => cx.report(decl, LIST_IS_EMPTY),
                };
            }
            return;
        }
        if attributes.len() < 2 {
            return;
        }
        let reserved_list = match self.reserved_first {
            // `dangerouslySetInnerHTML` is only "reserved" on DOM components
            ReservedFirst::List(ReservedList([children, _, key, reference])) if !is_dom_component(jsx) => {
                Some(ReservedList([children, false, key, reference]))
            }
            ReservedFirst::List(list) => Some(list),
            _ => None,
        };
        let element = Element { rule: self, attributes, reserved_list, fix: OnceCell::new() };
        let mut memo: Option<Attribute<'a>> = None;
        for decl in attributes {
            if cx.has_reported_too_much() {
                return;
            }
            // After a spread the next one is compared with itself.
            let Some(current) = Attribute::new(decl, self) else {
                memo = None;
                continue;
            };
            let Some(mut previous) = memo.take() else {
                memo = Some(current);
                continue;
            };
            memo = Some(match element.check(&previous, &current) {
                Found::InOrder => current,
                Found::Current(message) => {
                    element.report(decl, message, cx);
                    previous
                }
                Found::Previous(message) => {
                    if !previous.reported.contains(&message.id) {
                        previous.reported.push(message.id);
                        element.report(previous.decl, message, cx);
                    }
                    previous
                }
            });
        }
    }
}

impl JsxSortProps {
    /// Of two names, which are in lower case with `ignoreCase`.
    fn order_of_names(&self, a: &[u8], b: &[u8]) -> Ordering {
        match self.ignore_case || self.has_locale {
            true => strings::locale_compare(a, b),
            false => strings::order_utf16(a, b),
        }
    }

    fn name_to_sort_by<'a>(&self, name: &'a [u8]) -> Cow<'a, [u8]> {
        if self.ignore_case { text::to_lower_case(name) } else { Cow::Borrowed(name) }
    }
}

impl ReservedFirst {
    /// `validateReservedFirstConfig`, and `reservedList`
    fn new(reserved_first: Option<&Json>) -> ReservedFirst {
        let words = match reserved_first {
            Some(Json::Array(words)) => words,
            Some(Json::Bool(true)) => return ReservedFirst::List(ReservedList([true; 4])),
            _ => return ReservedFirst::No,
        };
        let (mut list, mut non_reserved_words) = ([false; 4], Vec::new());
        for word in words {
            let mut reserved = RESERVED_PROPS_LIST.iter().zip(&mut list);
            match reserved.find(|it| word.as_str() == Some(it.0.as_bytes())) {
                Some((_, is_in_list)) => *is_in_list = true,
                None => non_reserved_words.push(string_in_array(word)),
            }
        }
        match (words.is_empty(), non_reserved_words.is_empty()) {
            (true, _) => ReservedFirst::Error(None),
            (false, true) => ReservedFirst::List(ReservedList(list)),
            (false, false) => ReservedFirst::Error(Some(non_reserved_words.join(&b","[..]))),
        }
    }
}

/// What `Array.prototype.toString` makes of an element.
fn string_in_array(value: &Json) -> Vec<u8> {
    match value {
        Json::Null => Vec::new(),
        Json::Bool(it) => it.to_string().into_bytes(),
        Json::Number(it) => text::number_to_string(*it),
        Json::String(it) => it.clone(),
        Json::Array(all) => all.iter().map(string_in_array).collect::<Vec<_>>().join(&b","[..]),
        Json::Object(_) => b"[object Object]".to_vec(),
    }
}

impl ReservedList {
    /// `isReservedPropName`
    fn has(self, name: &[u8]) -> bool {
        RESERVED_PROPS_LIST.iter().zip(self.0).any(|(it, is_in_list)| is_in_list && it.as_bytes() == name)
    }
}

/// `propTypesSortUtil.isCallbackPropName`
fn is_callback_prop_name(name: &[u8]) -> bool {
    matches!(name, [b'o', b'n', b'A'..=b'Z', ..])
}

/// `isMultilineProp`
fn is_multiline_prop(node: Prop<'_>) -> bool {
    !ast_utils::is_on_one_line(node.file(), node.span())
}

impl<'a> Attribute<'a> {
    /// `None` for a spread.
    fn new(decl: Prop<'a>, rule: &JsxSortProps) -> Option<Attribute<'a>> {
        let name = get_jsx_attribute_name(decl)?;
        Some(Attribute {
            decl,
            name: rule.name_to_sort_by(name),
            is_callback: rule.callbacks_last && is_callback_prop_name(name),
            reported: SmallVec::new(),
        })
    }
}

impl<'a> Element<'a, '_> {
    fn check(&self, previous: &Attribute<'a>, current: &Attribute<'a>) -> Found {
        let rule = self.rule;
        if let Some(list) = self.reserved_list {
            match (list.has(&previous.name), list.has(&current.name)) {
                (true, false) => return Found::InOrder,
                (false, true) => return Found::Current(LIST_RESERVED_PROPS_FIRST),
                _ => {}
            }
        }
        match (previous.is_callback, current.is_callback) {
            (false, true) => return Found::InOrder,
            (true, false) => return Found::Previous(LIST_CALLBACKS_LAST),
            _ => {}
        }
        let values = (previous.decl.value().is_some(), current.decl.value().is_some());
        match values {
            (false, true) if rule.shorthand_first => return Found::InOrder,
            (true, false) if rule.shorthand_first => return Found::Current(LIST_SHORTHAND_FIRST),
            (true, false) if rule.shorthand_last => return Found::InOrder,
            (false, true) if rule.shorthand_last => return Found::Previous(LIST_SHORTHAND_LAST),
            _ => {}
        }
        if rule.multiline != Multiline::Ignore {
            match (rule.multiline, is_multiline_prop(previous.decl), is_multiline_prop(current.decl)) {
                (Multiline::First, true, false) | (Multiline::Last, false, true) => return Found::InOrder,
                (Multiline::First, false, true) => return Found::Current(LIST_MULTILINE_FIRST),
                (Multiline::Last, true, false) => return Found::Previous(LIST_MULTILINE_LAST),
                _ => {}
            }
        }
        if !rule.no_sort_alphabetically && rule.order_of_names(&previous.name, &current.name) == Ordering::Greater {
            return Found::Current(SORT_PROPS_BY_ALPHA);
        }
        Found::InOrder
    }

    /// `reportNodeAttribute`
    fn report(&self, node_attribute: Prop<'a>, message: Message, cx: &Cx<'a, JsxSortProps>) {
        let Some(name) = node_attribute.key() else {
            return;
        };
        cx.report(name.span(cx.file()), message).fix(|fixer| self.fix.get_or_init(|| self.generate_fix(fixer)).clone());
    }

    /// `generateFixerFunction`: the same for all reports in the element.
    #[cold]
    #[inline(never)]
    fn generate_fix(&self, fixer: Fixer<'a>) -> Fix {
        let (file, rule) = (fixer.file(), self.rule);
        let sortable = self.get_groups_of_sortable_attributes(file);
        let (Some(first), Some(last)) = (sortable.first(), sortable.last()) else {
            return fixer.replace(Span::empty(0), "");
        };
        let mut sorted: Vec<&Sortable<'a>> = sortable.iter().collect();
        // `contextCompare`
        utils::sort::sort_by(&mut sorted, |a, b| match (a.group, a.rank).cmp(&(b.group, b.rank)) {
            Ordering::Equal if !rule.no_sort_alphabetically => rule.order_of_names(&a.name, &b.name),
            by_rank => by_rank,
        });
        let (mut source, mut at) = (Vec::new(), first.span.start);
        for (attr, sorted_attr) in sortable.iter().zip(sorted) {
            source.extend_from_slice(file.slice(Span::before(at, attr.span)));
            source.extend_from_slice(file.slice(sorted_attr.span));
            at = attr.span.end;
        }
        fixer.replace(first.span.to(last.span), source)
    }

    /// `getGroupsOfSortableAttributes`: the groups one after the other.
    fn get_groups_of_sortable_attributes(&self, file: &'a File<'a>) -> Vec<Sortable<'a>> {
        let (attributes, rule) = (self.attributes, self.rule);
        let is_spread = |it: Prop<'a>| it.kind() == PropKind::Spread;
        let line_of = |it: Span| file.line_of(it.start);
        let mut sortable = Vec::with_capacity(attributes.len());
        let (mut group, mut i) = (0, 0);
        while let Some(attribute) = attributes.get(i) {
            let next_attribute = attributes.get(i + 1).map(Prop::span);
            let last_attr = i.checked_sub(1).and_then(|it| attributes.get(it));
            if last_attr.is_none_or(|it| is_spread(it) && !is_spread(attribute)) {
                group += 1;
            }
            i += 1;
            let Some(name) = get_jsx_attribute_name(attribute) else {
                continue;
            };
            let (whole, mut comment) = (attribute.span(), file.comments_after(attribute));
            let attribute_line = line_of(whole);
            // Where it ends, `hasComment`, and whether the next attribute goes with it.
            let (end, has_comment, takes_next) = match (comment.next(), comment.next(), next_attribute) {
                (None, ..) => (whole.end, false, false),
                (Some(first), None, Some(next)) if attribute_line + 1 == line_of(first.span()) => {
                    (next.end, true, true)
                }
                (Some(first), None, next) if attribute_line == line_of(first.span()) => {
                    match (first.kind() == TokenKind::Block, next) {
                        (true, Some(next)) => (next.end, true, true),
                        (is_block, _) => (first.end(), is_block, false),
                    }
                }
                (Some(_), Some(second), Some(next)) if attribute_line + 1 == line_of(second.span()) => {
                    let mut comment_next_attribute = file.comments_after(next);
                    match (comment_next_attribute.next(), comment_next_attribute.next()) {
                        (Some(only), None) if line_of(next) == line_of(only.span()) => (only.end(), true, true),
                        _ => (next.end, true, true),
                    }
                }
                // It stays where it is.
                _ => continue,
            };
            i += usize::from(takes_next);
            let has_value = attribute.value().is_some();
            let rank = [
                has_comment,
                self.reserved_list.is_some_and(|it| !it.has(name)),
                rule.callbacks_last && is_callback_prop_name(name),
                if rule.shorthand_first { has_value } else { rule.shorthand_last && !has_value },
                match rule.multiline {
                    Multiline::Ignore => false,
                    Multiline::First => !is_multiline_prop(attribute),
                    Multiline::Last => is_multiline_prop(attribute),
                },
            ];
            let span = Span::new(whole.start, end);
            sortable.push(Sortable { span, group, rank, name: rule.name_to_sort_by(name) });
        }
        sortable
    }
}
