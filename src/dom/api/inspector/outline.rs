//! Where the rules and the declarations are in the text of a style sheet.

use core::ops::Range;

use bun_core::strings;

use super::*;
use crate::declarations::{Accepts, DeclarationList};
use crate::rule_tree::{Item, Level, items};
use crate::scan;
use crate::sheet::{Within, supports_declaration};
use crate::values::Out;

pub(super) struct Rule {
    pub(super) prelude: Range<usize>,
    pub(super) body: Range<usize>,
    pub(super) parent: Option<usize>,
}

#[derive(Default)]
pub(super) struct Outline {
    pub(super) text: Out,
    /// For what has been loaded by the page.
    pub(super) id: Option<String>,
    /// In the order in which they start.
    pub(super) rules: Vec<Rule>,
    lines: Vec<usize>,
    /// Where each character ends that has more bytes than units of UTF-16, and how many more there are up to there.
    wide: Vec<(usize, usize)>,
}

pub(super) fn longhands_of(name: &[u8], value: &[u8]) -> Value {
    let list = DeclarationList::parse(
        Accepts::Properties(Within::Style),
        &[name, b":", value].concat(),
    );
    let keys = (0..list.len())
        .filter_map(|it| list.key_at(it))
        .filter(|_| list.len() > 1);
    keys.map(|key| record! { "name": &*key.name(), "value": lossy(&list.get(key)), "important": list.is_important(key).then_some(true) }).collect()
}

impl Outline {
    pub(super) fn of_declarations(text: Out, id: Option<String>) -> Outline {
        let lines = [0]
            .into_iter()
            .chain(
                text.iter()
                    .zip(1..)
                    .filter(|it| *it.0 == b'\n')
                    .map(|it| it.1),
            )
            .collect();
        let mut wide = Vec::new();
        if !text.is_ascii() {
            for (start, end, character) in
                bstr::ByteSlice::char_indices(&*text).filter(|it| it.1 - it.0 > 1)
            {
                wide.push((
                    end,
                    wide.last().map_or(0, |it: &(usize, usize)| it.1) + end
                        - start
                        - character.len_utf16(),
                ));
            }
        }
        Outline {
            text,
            id,
            rules: Vec::new(),
            lines,
            wide,
        }
    }

    pub(super) fn of_sheet(text: Out, id: Option<String>) -> Outline {
        let mut outline = Outline::of_declarations(text, id);
        outline.find_rules(0..outline.text.len(), None, false, 0);
        outline
    }

    fn find_rules(
        &mut self,
        range: Range<usize>,
        parent: Option<usize>,
        has_declarations: bool,
        depth: u8,
    ) {
        let level = if has_declarations {
            Level::RulesAndDeclarations
        } else if parent.is_some() {
            Level::Rules
        } else {
            Level::Sheet
        };
        let found: Vec<_> = items(&self.text, range, level).collect();
        for item in found {
            let Item::Rule(prelude, Some(body)) = item else {
                continue;
            };
            let prelude = prelude.start..prelude.start + self.text[prelude].trim_ascii_end().len();
            self.rules.push(Rule {
                prelude,
                body: body.clone(),
                parent,
            });
            let has_declarations = match &*self.at_rule(self.rules.len() - 1).0 {
                b"media" | b"supports" | b"layer" | b"container" | b"starting-style" => {
                    has_declarations
                }
                b"keyframes" | b"-webkit-keyframes" => false,
                _ => true,
            };
            if depth < u8::MAX && strings::contains_char(&self.text[body.clone()], b'{') {
                self.find_rules(
                    body,
                    Some(self.rules.len() - 1),
                    has_declarations,
                    depth + 1,
                );
            }
        }
    }

    /// The name, which is empty for other rules, and the rest of the prelude.
    pub(super) fn at_rule(&self, rule: usize) -> (Out, Range<usize>) {
        let prelude = self.rules[rule].prelude.clone();
        let text = &self.text[prelude.clone()];
        let name = if text.starts_with(b"@") {
            scan::at_keyword(text)
        } else {
            return (Out::new(), prelude);
        };
        (
            name.to_ascii_lowercase(),
            prelude.end - text[1 + name.len()..].trim_ascii_start().len()..prelude.end,
        )
    }

    pub(super) fn lineage(&self, rule: usize) -> impl Iterator<Item = usize> + Clone {
        core::iter::successors(Some(rule), |it| self.rules[*it].parent)
    }

    /// The innermost one that has this in its body.
    pub(super) fn rule_at(&self, at: usize) -> Option<usize> {
        let last = self
            .rules
            .partition_point(|it| it.body.start <= at)
            .checked_sub(1)?;
        self.lineage(last).find(|it| at <= self.rules[*it].body.end)
    }

    /// Between the rules that are nested in it.
    pub(super) fn declarations_at(&self, rule: usize, at: usize) -> Range<usize> {
        let body = self.rules[rule].body.clone();
        let nested = self.rules[rule + 1..]
            .iter()
            .take_while(|it| it.prelude.start < body.end)
            .filter(|it| it.parent == Some(rule));
        let start = nested
            .clone()
            .take_while(|it| it.body.end < at)
            .last()
            .map_or(body.start, |it| it.body.end + 1);
        start
            ..nested
                .map(|it| it.prelude.start)
                .find(|it| *it >= start)
                .unwrap_or(body.end)
    }

    fn units_before(&self, at: usize) -> usize {
        at - self.wide[..self.wide.partition_point(|it| it.0 <= at)]
            .last()
            .map_or(0, |it| it.1)
    }

    pub(super) fn position(&self, at: usize) -> [usize; 2] {
        let line = self.lines.partition_point(|it| *it <= at) - 1;
        [
            line,
            self.units_before(at) - self.units_before(self.lines[line]),
        ]
    }

    fn offset(&self, line: &Value, column: &Value) -> Option<usize> {
        let units = self.units_before(*self.lines.get(line.number() as usize)?)
            + column.number() as u32 as usize;
        let at = units
            + self.wide[..self.wide.partition_point(|it| it.0 - it.1 <= units)]
                .last()
                .map_or(0, |it| it.1);
        (at <= self.text.len()).then_some(at)
    }

    pub(super) fn range_from(&self, it: &Value) -> Result<Range<usize>, String> {
        let range = self
            .offset(&it["startLine"], &it["startColumn"])
            .zip(self.offset(&it["endLine"], &it["endColumn"]));
        range
            .filter(|it| it.0 <= it.1)
            .map(|it| it.0..it.1)
            .ok_or_else(|| "Specified range is out of bounds".into())
    }

    /// Nothing for what cannot be edited.
    pub(super) fn range(&self, it: &Range<usize>) -> Value {
        let [start, end] = [it.start, it.end].map(|it| self.position(it));
        self.id.as_ref().map(|_| record! { "startLine": start[0], "startColumn": start[1], "endLine": end[0], "endColumn": end[1] }).into()
    }

    pub(super) fn located(&self, it: &Range<usize>) -> Value {
        record! { "text": lossy(&self.text[it.clone()]), "range": self.range(it), "styleSheetId": self.id.as_deref() }
    }

    fn property(
        &self,
        declaration: &[u8],
        whole: Range<usize>,
        is_disabled: bool,
    ) -> Option<Value> {
        let (name, value) = scan::declaration(declaration)?;
        let (bare, is_important) = scan::without_priority(value);
        let is_valid = name.starts_with(b"--")
            || supports_declaration(name, bare, crate::sheet::Within::Style);
        let is_shown = if self.id.is_some() {
            is_valid || !is_disabled
        } else {
            is_valid && !is_disabled && !name.starts_with(b"-internal-")
        };
        is_shown.then(|| {
            record! {
                "name": lossy(name), "value": lossy(scan::trim(value)), "important": is_important.then_some(true), "implicit": false, "parsedOk": (!is_valid).then_some(false), "disabled": is_disabled,
                "text": self.id.as_ref().map(|_| lossy(&self.text[whole.clone()])), "range": self.range(&whole), "longhandProperties": longhands_of(name, value),
            }
        })
    }

    /// Those that are turned off.
    fn properties_in_comments(&self, Range { mut start, end }: Range<usize>, all: &mut Vec<Value>) {
        while let Some(open) = strings::index_of(&self.text[start..end], b"/*").map(|it| start + it)
            && let Some(close) =
                strings::index_of(&self.text[open + 2..end], b"*/").map(|it| open + 2 + it)
        {
            start = close + 2;
            all.extend(self.property(self.text[open + 2..close].trim_ascii(), open..start, true));
        }
    }

    pub(super) fn style(&self, range: Range<usize>) -> Value {
        let (mut all, mut at) = (Vec::new(), range.start);
        for item in items(&self.text, range.clone(), Level::RulesAndDeclarations) {
            let Item::Declaration(it) = item else {
                continue;
            };
            self.properties_in_comments(at..it.start, &mut all);
            at = it.start + self.text[it.clone()].trim_ascii_end().len();
            all.extend(self.property(&self.text[it.start..at], it.start..at, false));
        }
        self.properties_in_comments(at..range.end, &mut all);
        record! {
            "styleSheetId": self.id.as_deref(), "cssProperties": Value::List(all), "shorthandEntries": list![],
            "cssText": self.id.as_ref().map(|_| lossy(&self.text[range.clone()])), "range": self.range(&range),
        }
    }

    pub(super) fn selectors(&self, prelude: Range<usize>) -> Vec<Range<usize>> {
        let (mut all, mut start) = (Vec::new(), prelude.start);
        while start < prelude.end {
            let end = scan::end_of_list_item(&self.text[..prelude.end], start);
            let first = end - self.text[start..end].trim_ascii_start().len();
            all.push(first..first + self.text[first..end].trim_ascii_end().len());
            start = end + 1;
        }
        all
    }

    pub(super) fn selector_list(&self, prelude: Range<usize>) -> Value {
        let each = self
            .selectors(prelude.clone())
            .into_iter()
            .map(|it| record! { "text": lossy(&self.text[it.clone()]), "range": self.range(&it) });
        record! { "selectors": each.collect::<Value>(), "text": lossy(&self.text[prelude]) }
    }

    /// As `/*# sourceURL=a.css */`
    pub(super) fn magic_comment(&self, name: &str) -> Option<&[u8]> {
        let after =
            &self.text[strings::last_index_of(&self.text, format!("# {name}=").as_bytes())?
                + name.len()
                + 3..];
        Some(after[..strings::index_of(after, b"*/")?].trim_ascii())
    }
}
