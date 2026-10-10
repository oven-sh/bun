use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unescaped HTML entities from appearing in markup.
pub struct NoUnescapedEntities {
    /// `None`: not given.
    forbid: Option<Entities>,
    defaults: Entities,
}

const UNESCAPED_ENTITY: Message = Message::new("unescapedEntity", "HTML entity, `{{entity}}` , must be escaped.");
const UNESCAPED_ENTITY_ALTS: Message =
    Message::new("unescapedEntityAlts", "`{{entity}}` can be escaped with {{alts}}.");
const REPLACE_WITH_ALT: Message = Message::new("replaceWithAlt", "Replace with `{{alt}}`.");
const NO_UNESCAPED_ENTITIES: Message = Message::new("", "`{{unescaped}}` can be escaped with {{escaped}}");
const REPLACE: Message = Message::new("", "Replace with `{{alt}}`");

const DEFAULTS: [(&str, &[&str]); 4] = [
    (">", &["&gt;"]),
    ("\"", &["&quot;", "&ldquo;", "&#34;", "&rdquo;"]),
    ("'", &["&apos;", "&lsquo;", "&#39;", "&rsquo;"]),
    ("}", &["&#125;"]),
];

struct Entity {
    char: Box<[u8]>,
    /// `None`: a string of `forbid`.
    alternatives: Option<Vec<Box<[u8]>>>,
}

struct Entities {
    list: Vec<Entity>,
    /// The first byte of each.
    starts: Vec<u8>,
    /// One of them may be in a text that is nothing but blanks.
    has_blank: bool,
}

impl Rule for NoUnescapedEntities {
    const META: Meta =
        Meta::plugin(Plugin::React, "no-unescaped-entities", Kind::Suggestion).has_suggestions().recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let defaults = DEFAULTS.iter().map(|&(char, alternatives)| Entity {
            char: char.as_bytes().into(),
            alternatives: Some(alternatives.iter().map(|it| it.as_bytes().into()).collect()),
        });
        let given = |it: &Json| match it.as_str() {
            Some(char) => Some(Entity { char: char.into(), alternatives: None }),
            None => {
                let it = Object::of(Some(it));
                let alternatives = it.array("alternatives").iter().filter_map(Json::as_str).map(Box::from).collect();
                Some(Entity { char: it.get("char")?.as_str()?.into(), alternatives: Some(alternatives) })
            }
        };
        let forbid = options.object(0).get("forbid").and_then(Json::as_array);
        NoUnescapedEntities {
            forbid: forbid.map(|it| Entities::new(it.iter().filter_map(given).collect())),
            defaults: Entities::new(defaults.collect()),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint goes by the kind of the file.
        (!file.language().is_oxlint || is_jsx(file)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has no options.
        let entities = self.forbid.as_ref().filter(|_| !is_oxlint).unwrap_or(&self.defaults);
        let check = |jsx_text: Span| {
            if strings::index_of_any(cx.slice(jsx_text), &entities.starts).is_some() {
                entities.report_invalid_entity(jsx_text, is_oxlint, cx);
            }
        };
        let is_text = |it: &Expr| it.tag() == ExprTag::String && it.jsx_container_span().is_none();
        jsx.children().iter().filter(is_text).for_each(|it| check(it.span()));
        if entities.has_blank {
            for child in jsx.children_with_whitespace() {
                if let JsxChild::Whitespace(span) = child {
                    check(span);
                }
            }
        }
    }
}

impl Entities {
    /// Without those that are not one UTF-16 code unit of a line, which is what upstream compares them with.
    fn new(mut list: Vec<Entity>) -> Self {
        list.retain(|it| strings::wtf8_len_utf16(&it.char) == 1 && strings::js_line_break_len(&it.char) == 0);
        let starts: Vec<u8> = list.iter().filter_map(|it| it.char.first().copied()).collect();
        let has_blank = !starts.iter().all(u8::is_ascii_graphic);
        Entities { list, starts, has_blank }
    }

    #[cold]
    #[inline(never)]
    fn report_invalid_entity(&self, node: Span, is_oxlint: bool, cx: &Cx<'_, NoUnescapedEntities>) {
        let raw = cx.slice(node);
        for Entity { char, alternatives } in &self.list {
            let mut from = 0;
            while let Some(found) = raw.get(from..).and_then(|rest| strings::index_of(rest, char))
                && !cx.has_reported_too_much()
            {
                let index = from + found;
                from = index + char.len();
                let start = node.start + index as u32;
                let Some(alternatives) = alternatives else {
                    cx.report_at(start, UNESCAPED_ENTITY).data("entity", char.to_vec());
                    continue;
                };
                // oxlint: `a or b`
                let (quote, separator): (&[u8], &[u8]) = if is_oxlint { (b"", b" or ") } else { (b"`", b", ") };
                let alts: Vec<Vec<u8>> = alternatives.iter().map(|alt| [quote, &**alt, quote].concat()).collect();
                // oxlint marks the character, and a suggestion of it replaces no more than that.
                let character = Span::new(start, start + char.len() as u32);
                let mut report = match is_oxlint {
                    true => cx.report(character, NO_UNESCAPED_ENTITIES).data("unescaped", char.to_vec()),
                    false => cx.report_at(start, UNESCAPED_ENTITY_ALTS).data("entity", char.to_vec()),
                };
                report = report.data(if is_oxlint { "escaped" } else { "alts" }, alts.join(separator));
                for alt in alternatives {
                    let message = if is_oxlint { REPLACE } else { REPLACE_WITH_ALT };
                    report = report.suggest_with(message, &[("alt", &**alt)], |fixer| match is_oxlint {
                        true => fixer.replace(character, &**alt),
                        false => fixer.replace(node, replaced(raw, index, alt)),
                    });
                }
            }
        }
    }
}

/// `newText` of upstream's `fix`: it counts the lines as ESLint does, and takes that one of those that `\n` ends.
fn replaced(raw: &[u8], at: usize, alt: &[u8]) -> Vec<u8> {
    let before = strings::js_lines(raw.get(..at).unwrap_or_default());
    let (line_to_change, index) = (before.skip(1).count(), strings::wtf8_len_utf16(before.last().unwrap_or_default()));
    let mut new_text = Vec::with_capacity(raw.len() + alt.len());
    for (idx, line) in strings::split(raw, b"\n").enumerate() {
        if idx > 0 {
            new_text.push(b'\n');
        }
        if idx == line_to_change {
            new_text.extend_from_slice(strings::wtf8_slice_by_utf16(line, 0, index));
            new_text.extend_from_slice(alt);
            new_text.extend_from_slice(strings::wtf8_slice_by_utf16(line, index + 1, u32::MAX));
        } else {
            new_text.extend_from_slice(line);
        }
    }
    new_text
}
