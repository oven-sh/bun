#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/utils/ast-utils/pattern-source.ts` of eslint-plugin-regexp.
//! A place in a pattern is an offset in BYTES of [`PatternSource::value`].

use crate::regexp_ast_utils::{
    dereference_owned_variable, get_property_name, get_static_value, get_string_value_range,
    is_string_literal,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast as re;
use bun_lint::regex::utf16_index;
use bun_lint::utils::eslint_utils::StaticValue;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;

/// upstream's `PatternRange`: the range of a node or a construct within a pattern.
#[derive(Copy, Clone)]
pub(crate) struct PatternRange {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

impl From<re::Node<'_>> for PatternRange {
    #[inline]
    fn from(node: re::Node<'_>) -> Self {
        PatternRange {
            start: node.start(),
            end: node.end(),
        }
    }
}

/// upstream's `PatternReplaceRange["type"]`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ReplaceRangeKind {
    RegExp,
    SingleQuotedString,
    DoubleQuotedString,
}

/// upstream's `PatternReplaceRange`: a range in source code that can be edited.
#[derive(Copy, Clone)]
pub(crate) struct PatternReplaceRange {
    pub(crate) range: Span,
    pub(crate) kind: ReplaceRangeKind,
}

impl PatternReplaceRange {
    /// upstream's `fromLiteral`. `node_range` and `range` are places in `value`.
    fn from_literal(
        node: Expr<'_>,
        value: &[u8],
        node_range: PatternRange,
        range: PatternRange,
    ) -> Option<Self> {
        if node.tag() == ExprTag::Regex {
            let node_start = node.span().start + 1;
            let start = range.start.saturating_sub(node_range.start);
            let end = range.end.saturating_sub(node_range.start);
            return Some(PatternReplaceRange {
                range: Span::new(node_start + start, node_start + end),
                kind: ReplaceRangeKind::RegExp,
            });
        }
        if !is_string_literal(node) {
            return None;
        }
        // What a string literal has is counted in UTF-16 code units.
        let units = |offset: u32| utf16_index(value, offset as usize) as u32;
        let node_start = units(node_range.start);
        let start = units(range.start).saturating_sub(node_start);
        let end = units(range.end).saturating_sub(node_start);
        Some(PatternReplaceRange {
            range: get_string_value_range(node, start, end)?,
            kind: match node.text().first() {
                Some(b'\'') => ReplaceRangeKind::SingleQuotedString,
                _ => ReplaceRangeKind::DoubleQuotedString,
            },
        })
    }

    /// upstream's `escape`
    pub(crate) fn escape(&self, text: &[u8]) -> Vec<u8> {
        let quote = match self.kind {
            ReplaceRangeKind::RegExp => None,
            ReplaceRangeKind::SingleQuotedString => Some(b'\''),
            ReplaceRangeKind::DoubleQuotedString => Some(b'"'),
        };
        let mut escaped = Vec::with_capacity(text.len());
        for &byte in text {
            match byte {
                b'\n' => escaped.extend_from_slice(b"\\n"),
                b'\r' => escaped.extend_from_slice(b"\\r"),
                b'\t' if quote.is_some() => escaped.extend_from_slice(b"\\t"),
                b'\\' if quote.is_some() => escaped.extend_from_slice(b"\\\\"),
                _ if quote == Some(byte) => escaped.extend_from_slice(&[b'\\', byte]),
                _ => escaped.push(byte),
            }
        }
        escaped
    }

    /// upstream's `replace`
    pub(crate) fn replace(&self, fixer: Fixer<'_>, text: &[u8]) -> Fix {
        fixer.replace(self.range, self.escape(text))
    }

    /// upstream's `remove`
    pub(crate) fn remove(&self, fixer: Fixer<'_>) -> Fix {
        fixer.remove(self.range)
    }

    /// upstream's `insertAfter`
    pub(crate) fn insert_after(&self, fixer: Fixer<'_>, text: &[u8]) -> Fix {
        fixer.insert_after(self.range, self.escape(text))
    }

    /// upstream's `insertBefore`
    pub(crate) fn insert_before(&self, fixer: Fixer<'_>, text: &[u8]) -> Fix {
        fixer.insert_before(self.range, self.escape(text))
    }
}

/// upstream's `PatternSegment`. Its `value` is [`PatternSource::value`] from `start` to `end`.
#[derive(Copy, Clone)]
struct PatternSegment<'a> {
    node: Expr<'a>,
    start: u32,
    end: u32,
}

impl<'a> PatternSegment<'a> {
    /// upstream's `contains`
    fn contains(&self, range: PatternRange) -> bool {
        self.start <= range.start && range.end <= self.end
    }

    /// upstream's `getOwnedRegExpLiteral`
    fn get_owned_regexp_literal(&self) -> Option<Expr<'a>> {
        if self.node.tag() == ExprTag::Regex {
            return Some(self.node);
        }
        // `/foo/.source`. The whole of an optional chain is a `ChainExpression`.
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = self.node.kind()
            && obj.tag() == ExprTag::Regex
            && !self.node.is_chain_root()
            && get_property_name(self.node, false).is_some_and(|name| &*name == b"source")
        {
            return Some(obj);
        }
        None
    }

    /// upstream's `getReplaceRange`. `value` is the whole [`PatternSource::value`].
    fn get_replace_range(&self, value: &[u8], range: PatternRange) -> Option<PatternReplaceRange> {
        if !self.contains(range) {
            return None;
        }
        let node_range = PatternRange {
            start: self.start,
            end: self.end,
        };
        // Of the `Literal`s that are no regular expression only a string has a range.
        let literal = self.get_owned_regexp_literal().unwrap_or(self.node);
        PatternReplaceRange::from_literal(literal, value, node_range, range)
    }

    /// upstream's `getAstRange`
    fn get_ast_range(&self, value: &[u8], range: PatternRange) -> Span {
        match self.get_replace_range(value, range) {
            Some(replace_range) => replace_range.range,
            None => self.node.span(),
        }
    }
}

/// upstream's `RegExpValue`
pub(crate) struct RegExpValue<'a> {
    pub(crate) source: Cow<'a, [u8]>,
    pub(crate) flags: Cow<'a, [u8]>,
    /// The literal, if the RegExp object is one that is owned: not shared, made by nothing else.
    pub(crate) owned_node: Option<Expr<'a>>,
}

/// upstream's `PatternSource`
pub(crate) struct PatternSource<'a> {
    pub(crate) node: Expr<'a>,
    pub(crate) value: Cow<'a, [u8]>,
    /// One after the other in `value`.
    segments: SmallVec<[PatternSegment<'a>; 1]>,
    /// `/foo/`, `RegExp(/foo/, "i")`: the pattern is defined by a RegExp object. `RegExp("foo")`,
    /// by a string: `None`.
    pub(crate) regexp_value: Option<RegExpValue<'a>>,
}

/// No string that is put together is longer, as in `regexp_ast_utils::get_static_value`.
const MAX_LEN: usize = 1 << 20;

impl<'a> PatternSource<'a> {
    /// upstream's `isStringValue`
    pub(crate) fn is_string_value(&self) -> bool {
        self.regexp_value.is_none()
    }

    /// upstream's `fromExpression`
    pub(crate) fn from_expression(expression: Expr<'a>) -> Option<Self> {
        let expression = dereference_owned_variable(expression);
        if expression.tag() == ExprTag::Regex {
            return Some(Self::from_regexp_literal(expression));
        }
        let flat = flatten_plus(expression);
        let mut items: SmallVec<[PatternSegment<'a>; 1]> = SmallVec::with_capacity(flat.len());
        let mut value: Cow<'a, [u8]> = Cow::Borrowed(b"");
        for &e in &flat {
            let piece = match get_static_value(e)? {
                // A reference that is not owned to something that evaluates to a RegExp object.
                StaticValue::Regex { pattern, flags } if flat.len() == 1 => {
                    return Some(Self::from_regexp_object(e, pattern, flags));
                }
                StaticValue::String(piece) => piece,
                _ => return None,
            };
            let (before, len) = (value.len(), piece.len());
            if before == 0 {
                value = piece;
            } else {
                strings::push_wtf8(value.to_mut(), &piece);
                if value.len() > MAX_LEN {
                    return None;
                }
            }
            // Two halves of a character that meet become its 4 bytes: 2 are of each segment.
            let start = (before - usize::from(value.len() < before + len)) as u32;
            for item in items.iter_mut().rev().take_while(|item| item.end > start) {
                item.start = item.start.min(start);
                item.end = start;
            }
            items.push(PatternSegment {
                node: e,
                start,
                end: value.len() as u32,
            });
        }
        Some(PatternSource {
            node: expression,
            value,
            segments: items,
            regexp_value: None,
        })
    }

    /// upstream's `fromRegExpObject`
    fn from_regexp_object(
        expression: Expr<'a>,
        source: Cow<'a, [u8]>,
        flags: Cow<'a, [u8]>,
    ) -> Self {
        PatternSource {
            node: expression,
            value: source.clone(),
            segments: smallvec![PatternSegment {
                node: expression,
                start: 0,
                end: source.len() as u32,
            }],
            regexp_value: Some(RegExpValue {
                source,
                flags,
                owned_node: None,
            }),
        }
    }

    /// upstream's `fromRegExpLiteral`
    pub(crate) fn from_regexp_literal(expression: Expr<'a>) -> Self {
        let (pattern, flags): (&[u8], &[u8]) = match expression.kind() {
            ExprKind::Regex(regex) => (regex.pattern(), regex.flags()),
            _ => (b"", b""),
        };
        PatternSource {
            node: expression,
            value: Cow::Borrowed(pattern),
            segments: smallvec![PatternSegment {
                node: expression,
                start: 0,
                end: pattern.len() as u32,
            }],
            regexp_value: Some(RegExpValue {
                source: Cow::Borrowed(pattern),
                flags: Cow::Borrowed(flags),
                owned_node: Some(expression),
            }),
        }
    }

    /// upstream's `getSegment`
    fn get_segment(&self, range: PatternRange) -> Option<&PatternSegment<'a>> {
        match self.get_segments(range) {
            [segment] => Some(segment),
            _ => None,
        }
    }

    /// upstream's `getSegments`: those that `range` overlaps.
    fn get_segments(&self, range: PatternRange) -> &[PatternSegment<'a>] {
        let from = self
            .segments
            .partition_point(|item| item.end <= range.start);
        let to = self.segments.partition_point(|item| item.start < range.end);
        self.segments.get(from..to).unwrap_or_default()
    }

    /// upstream's `getReplaceRange`
    #[inline]
    pub(crate) fn get_replace_range(
        &self,
        range: impl Into<PatternRange>,
    ) -> Option<PatternReplaceRange> {
        self.replace_range_of(range.into())
    }

    fn replace_range_of(&self, range: PatternRange) -> Option<PatternReplaceRange> {
        self.get_segment(range)?
            .get_replace_range(&self.value, range)
    }

    /// upstream's `getAstRange` and `getAstLocation`: about where `range` is written. It is for
    /// reports: a fix takes [`PatternSource::get_replace_range`].
    #[inline]
    pub(crate) fn get_ast_range(&self, range: impl Into<PatternRange>) -> Span {
        self.ast_range_of(range.into())
    }

    fn ast_range_of(&self, range: PatternRange) -> Span {
        let overlapping = self.get_segments(range);
        if let [segment] = overlapping {
            return segment.get_ast_range(&self.value, range);
        }
        // The range comes from several sources: all of them.
        overlapping
            .iter()
            .map(|item| item.node.span())
            .reduce(|all, next| Span::new(all.start.min(next.start), all.end.max(next.end)))
            .unwrap_or_else(|| self.node.span())
    }

    /// upstream's `getOwnedRegExpLiterals`: the literals that are only used to make this pattern.
    pub(crate) fn get_owned_regexp_literals(&self) -> SmallVec<[Expr<'a>; 1]> {
        self.segments
            .iter()
            .filter_map(PatternSegment::get_owned_regexp_literal)
            .collect()
    }
}

/// upstream's `flattenPlus`: the operands of `a + b + ..`, each in place of the variable that
/// owns it. Such an expression is as deep as it is long: a list of what is still to do.
fn flatten_plus<'a>(e: Expr<'a>) -> SmallVec<[Expr<'a>; 4]> {
    let mut flat = SmallVec::new();
    let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![e];
    let mut dereferenced = 0;
    while let Some(e) = pending.pop() {
        if let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = e.kind()
        {
            pending.push(right);
            pending.push(left);
            continue;
        }
        let de_ref = dereference_owned_variable(e);
        // A variable is owned by one place. Upstream recurses for ever in `var a = a + ""`.
        if de_ref != e && dereferenced < e.file().symbol_key_limit() {
            dereferenced += 1;
            pending.push(de_ref);
            continue;
        }
        flat.push(e);
    }
    flat
}
