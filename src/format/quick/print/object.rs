//! Objects, their properties and keys (object.js, property.js, key.js).

use crate::arena::SUB_SHIFT;
use crate::ast::{
    EB_BIGINT, EB_BOOLEAN, EB_NONE, EB_NUMBER, EB_STRING, F_COMPUTED, F_ESCAPE, F_EXT, F_INEXACT,
    F_OPTIONAL, F_SHORTHAND, F_SLOW_TEXT, k,
};
use crate::es5_id_table::{ES5_ID_PART, ES5_ID_START};
use crate::options::{QUOTE_PROPS_AS_NEEDED, QUOTE_PROPS_CONSISTENT, TRAILING_COMMA_NONE};
use crate::print::statics::{
    BIGINT, BOOLEAN, COLON, COMMA, DQUOTE, ELLIPSIS, LBRACE, LBRACKET, NUMBER, OF_, RBRACE,
    RBRACKET, SPACE, SQUOTE, STRING, SYMBOL,
};
use crate::print::util::IS_FUNCTION_LIKE;
use crate::{Quick, R, Words, rare, why, zeros};

pub(crate) struct PrintObject {
    /// What has_siblings_require_quoted() has found for the lists around the member that it was asked about last, the innermost last:
    /// the node with the list, and 1 if a member of it needs its quotes. `siblings_top` words of it count.
    siblings: Vec<i32>,
    siblings_top: i32,
}
impl PrintObject {
    pub(crate) fn new() -> Self {
        Self {
            siblings: zeros(32),
            siblings_top: 0,
        }
    }
}

pub(crate) fn print_object_is_digit(c: i32) -> bool {
    return c >= 48 && c <= 57;
}

impl Quick {
    /// /^(?:\d+|\d+\.\d+)$/
    pub(crate) fn is_simple_number(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        if p >= end || !print_object_is_digit(self.t.at(p)) {
            return false;
        }
        while p < end && print_object_is_digit(self.t.at(p)) {
            p += 1;
        }
        if p == end {
            return true;
        }
        if self.t.at(p) != 46 {
            return false;
        }
        p += 1;
        if p >= end {
            return false;
        }
        while p < end && print_object_is_digit(self.t.at(p)) {
            p += 1;
        }
        return p == end;
    }
}
pub(crate) fn print_object_in_ranges(table: &[u16], cp: i32) -> bool {
    let mut lo: i32 = 0;
    let mut hi = ((table.len() as i32) >> 1) - 1;
    while lo <= hi {
        let mid = (lo + hi) >> 1;
        if cp < table.at(mid * 2) {
            hi = mid - 1;
        } else if cp > table.at(mid * 2 + 1) {
            lo = mid + 1;
        } else {
            return true;
        }
    }
    return false;
}

impl Quick {
    pub(crate) fn is_es5_identifier_name(&self, start: i32, end: i32) -> bool {
        if start >= end {
            return false;
        }
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if c < 128 {
                let ok = (c >= 97 && c <= 122)
                    || (c >= 65 && c <= 90)
                    || c == 36
                    || c == 95
                    || (p > start && print_object_is_digit(c));
                if !ok {
                    return false;
                }
                p += 1;
                continue;
            }
            // only the basic multilingual plane has ES5 identifier characters
            let cp: i32;
            let first = p == start;
            if c < 0xe0 {
                cp = ((c & 0x1f) << 6) | (self.t.at(p + 1) & 0x3f);
                p += 2;
            } else if c < 0xf0 {
                cp = ((c & 0x0f) << 12)
                    | ((self.t.at(p + 1) & 0x3f) << 6)
                    | (self.t.at(p + 2) & 0x3f);
                p += 3;
            } else {
                return false;
            }
            if !print_object_in_ranges(
                if first {
                    ES5_ID_START.as_slice()
                } else {
                    ES5_ID_PART.as_slice()
                },
                cp,
            ) {
                return false;
            }
        }
        return true;
    }

    pub(crate) fn is_key_safe_to_unquote(&self, member: i32) -> R<bool> {
        let key = self.n.at(member + 4);
        if (self.n.at(key) & 0xff) != k::StringLiteral || (self.n.at(key) & F_ESCAPE) != 0 {
            return Ok(false);
        }
        let start = self.n.at(key + 1) + 1;
        let end = self.n.at(key + 2) - 1;
        let mk = self.n.at(member) & 0xff;
        if mk == k::MethodSignature
            && end - start == 3
            && self.t.at(start) == 110
            && self.t.at(start + 1) == 101
            && self.t.at(start + 2) == 119
        {
            // "new"
            return Ok(false);
        }
        if !(self.mode.is_type_script && mk == k::ClassProperty)
            && self.is_es5_identifier_name(start, end)
        {
            return Ok(true);
        }
        return Ok(self.mode.unquotes_numbers
            && (self.n.at(member) & 0xff) != k::ImportAttribute
            && self.is_simple_number(start, end)
            && self.round_trips_as_number(start, end)?);
    }

    pub(crate) fn is_key_safe_to_quote(&self, member: i32) -> R<bool> {
        let key = self.n.at(member + 4);
        let k = self.n.at(key) & 0xff;
        if k == k::Identifier {
            return Ok(true);
        }
        if k != k::NumericLiteral || self.mode.is_type_script {
            return Ok(false);
        }
        // String(value) === printNumber(raw), and that is a simple number. A rare question, so strings will do.
        return self.number_is_printed_as_its_value(self.n.at(key + 1), self.n.at(key + 2));
    }

    pub(crate) fn members_of(&self, parent: i32) -> i32 {
        match self.n.at(parent) & 0xff {
            k::ImportDeclaration => {
                return self.n.at(parent + 6);
            }
            k::ExportNamedDeclaration => {
                return self.n.at(parent + 7);
            }
            k::ExportAllDeclaration => {
                return self.n.at(parent + 6);
            }
            _ => {}
        }
        return self.n.at(parent + 4);
    }

    /// Can the value of the string `key`, which has a backslash in it, be a name or a number? Yes unless there is something in it that is part of neither:
    /// what is no letter, digit, `_`, `$` or `.`, or an escape for one character that is not spelled as a number.
    #[cold]
    fn may_spell_a_name(&self, key: i32) -> bool {
        let mut rest = self.t.sub(self.n.at(key + 1) + 1, self.n.at(key + 2) - 1);
        loop {
            rest = match rest {
                [] => return true,
                [b'\\', b'x' | b'u' | b'0'..=b'7' | b'\n', rest @ ..] => rest,
                [b'{' | b'}', rest @ ..] => rest,
                [
                    b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$' | b'.' | 0x80..,
                    rest @ ..,
                ] => rest,
                _ => return false,
            };
        }
    }

    pub(crate) fn has_siblings_require_quoted(&mut self, member: i32) -> R<bool> {
        let parent = self.n.at(member + 3);
        // The lists that are not around this member are done with.
        let mut top = self.print_object.siblings_top;
        while top > 0 {
            let known = self.print_object.siblings.at(top - 2);
            if known == parent {
                self.print_object.siblings_top = top;
                return Ok(self.print_object.siblings.at(top - 1) != 0);
            }
            let (start, end) = (self.n.at(known + 1), self.n.at(known + 2));
            let (inner_start, inner_end) = (self.n.at(parent + 1), self.n.at(parent + 2));
            if start <= inner_start && inner_end <= end && (start, end) != (inner_start, inner_end)
            {
                break;
            }
            top -= 2;
        }
        let list = self.members_of(parent);
        let mut result = false;
        let mut i: i32 = 1;
        'l0: while i <= self.n.at(list) {
            'c1: {
                let sibling = self.n.at(list + i);
                let k = self.n.at(sibling) & 0xff;
                if k == k::SpreadElement
                    || k == k::RestElement
                    || k == k::StaticBlock
                    || (self.n.at(sibling) & F_COMPUTED) != 0
                {
                    break 'c1;
                }
                let key = self.n.at(self.n.at(sibling + 4));
                if (key & 0xff) == k::StringLiteral && !self.is_key_safe_to_unquote(sibling)? {
                    // The long way goes by the value of a key that is spelled with an escape, Prettier by its text.
                    if (key & F_ESCAPE) != 0 && self.may_spell_a_name(self.n.at(sibling + 4)) {
                        return Err(self.rare(rare::UNLIKE_PRETTIER));
                    }
                    result = true;
                    break 'l0;
                }
            }
            i += 1;
        }
        if top + 2 > self.print_object.siblings.len() as i32 {
            self.make_room(|q| &mut q.print_object.siblings, top + 2);
        }
        self.print_object.siblings.put(top, parent);
        self.print_object.siblings.put(top + 1, result as i32);
        self.print_object.siblings_top = top + 2;
        return Ok(result);
    }

    /// What the printers have kept about nodes of the tree: the next tree has other nodes in their places.
    pub(crate) fn reset_key_cache(&mut self) {
        self.print_object.siblings_top = 0;
        self.forget_vue_filters();
        self.forget_member_around();
        self.forget_only_statement();
    }

    pub(crate) fn print_key(&mut self, member: i32) -> R<()> {
        let key = self.n.at(member + 4);
        if (self.n.at(member) & F_COMPUTED) != 0 {
            self.text(LBRACKET);
            // Whoever asks whether the key is one short text (isObjectPropertyWithShortKey) has to see the boundaries in it.
            let possible = self.doc.suffix_possible;
            self.doc.suffix_possible = true;
            self.print(key)?;
            self.doc.suffix_possible = possible;
            self.text(RBRACKET);
            return Ok(());
        }
        let k = self.n.at(key) & 0xff;
        if k == k::StringLiteral {
            if (self.options.quote_props == QUOTE_PROPS_AS_NEEDED
                || (self.options.quote_props == QUOTE_PROPS_CONSISTENT
                    && !self.has_siblings_require_quoted(member)?))
                && self.is_key_safe_to_unquote(member)?
            {
                self.print_leading_comments(key);
                let start = self.n.at(key + 1) + 1;
                let end = self.n.at(key + 2) - 1;
                if print_object_is_digit(self.t.at(start)) {
                    self.print_number_range(start, end);
                } else if (self.n.at(key) & F_SLOW_TEXT) != 0 {
                    self.slice_any(start, end);
                } else {
                    self.slice(start, end);
                }
                self.print_trailing_comments(key);
                return Ok(());
            }
        } else if (k == k::Identifier || k == k::NumericLiteral)
            && (self.options.quote_props == QUOTE_PROPS_CONSISTENT
                && self.has_siblings_require_quoted(member)?)
            && self.is_key_safe_to_quote(member)?
        {
            self.print_leading_comments(key);
            let quote = if self.options.single_quote {
                SQUOTE
            } else {
                DQUOTE
            };
            self.text(quote);
            if k == k::NumericLiteral {
                self.print_number_range(self.n.at(key + 1), self.n.at(key + 2));
            } else {
                self.print_name(key);
            }
            self.text(quote);
            self.print_trailing_comments(key);
            return Ok(());
        }
        self.print(key)?;
        Ok(())
    }

    pub(crate) fn print_property(&mut self, n: i32) -> R<()> {
        if (self.n.at(n) & F_SHORTHAND) != 0 {
            self.print(self.n.at(n + 5))?;
            return Ok(());
        }
        self.print_assignment(n, self.n.at(n + 5), COLON, 0)?;
        Ok(())
    }

    /// `{ members }`. `braceStart` is where the `{` stands in the source.
    pub(crate) fn print_members(
        &mut self,
        _n: i32,
        list: i32,
        should_break: bool,
        with_group: bool,
    ) -> R<()> {
        let count = self.n.at(list);
        let g = if with_group { self.group_open() } else { 0 };
        self.text(LBRACE);
        self.indent_open();
        if self.options.bracket_spacing {
            self.line();
        } else {
            self.softline();
        }
        let mut i: i32 = 1;
        while i <= count {
            self.reserve();
            let member = self.n.at(list + i);
            self.print_item(member)?;
            if i == count {
                break;
            }
            self.text(COMMA);
            self.line();
            if self.is_next_line_empty(member) {
                self.hardline();
            }
            i += 1;
        }
        if self.options.trailing_comma != TRAILING_COMMA_NONE
            && (self.n.at(self.n.at(list + count)) & 0xff) != k::RestElement
        {
            self.if_break_text(COMMA, 0, 0);
        }
        if self.options.bracket_spacing {
            self.dedent_line();
        } else {
            self.dedent_softline();
        }
        self.text(RBRACE);
        if with_group {
            self.group_close_with(g, should_break, 0);
            self.stays_expanded(g);
        }
        Ok(())
    }

    /// The body of an enum of Flow: `of string {A, B, ...}`.
    pub(crate) fn print_flow_enum_body(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        let g = self.group_open();
        self.text(LBRACE);
        self.indent_open();
        if self.options.bracket_spacing {
            self.line();
        } else {
            self.softline();
        }
        let mut i: i32 = 1;
        while i <= count {
            let member = self.n.at(list + i);
            self.print(member)?;
            self.text(COMMA);
            self.line();
            if self.is_next_line_empty(member) {
                self.hardline();
            }
            i += 1;
        }
        if self.has_dangling_comment(n) {
            self.print_dangling_comments(n);
            if self.has_line_comment(n)
                || self.has_newline(self.comment_end(self.last_dangling_comment(n)))
            {
                self.hardline();
            } else {
                self.line();
            }
        }
        self.text(ELLIPSIS);
        self.indent_close();
        if self.options.bracket_spacing {
            self.line();
        } else {
            self.softline();
        }
        self.text(RBRACE);
        self.group_close_with(g, true, 0);
        Ok(())
    }

    pub(crate) fn print_object(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        if (self.n.at(n) & 0xff) == k::EnumBody {
            let explicit_type = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
            if explicit_type != EB_NONE {
                self.text(OF_);
                self.text(if explicit_type == EB_BOOLEAN {
                    BOOLEAN
                } else {
                    if explicit_type == EB_NUMBER {
                        NUMBER
                    } else {
                        if explicit_type == EB_BIGINT {
                            BIGINT
                        } else {
                            if explicit_type == EB_STRING {
                                STRING
                            } else {
                                SYMBOL
                            }
                        }
                    }
                });
                self.text(SPACE);
            }
            if (self.n.at(n) & F_INEXACT) != 0 {
                self.print_flow_enum_body(n)?;
                return Ok(());
            }
        }
        if count == 0 {
            let g = self.group_open();
            self.text(LBRACE);
            self.print_dangling_comments_in_list(n);
            self.text(RBRACE);
            if (self.n.at(n) & (F_EXT | F_OPTIONAL)) != 0 {
                self.print_binding_suffix(n, self.n.at(n) & 0xff)?;
            }
            self.group_close(g);
            return Ok(());
        }
        let is_pattern = (self.n.at(n) & 0xff) == k::ObjectPattern;
        let parent = self.n.at(n + 3);
        let mut pk = self.n.at(parent) & 0xff;
        // a method without a body has a TSEmptyBodyFunctionExpression around its parameters
        if pk == k::ClassMethod && self.n.at(parent + 5) == 0 {
            pk = k::TSDeclareFunction;
        }
        let mut should_break = (self.n.at(n) & 0xff) == k::EnumBody;
        if should_break {
        } else if is_pattern {
            match pk {
                k::FunctionDeclaration
                | k::FunctionExpression
                | k::ArrowFunctionExpression
                | k::ObjectMethod
                | k::ClassMethod
                | k::AssignmentPattern
                | k::CatchClause => {}
                _ => {
                    let mut i: i32 = 1;
                    'l1: while i <= count {
                        'c2: {
                            let property = self.n.at(list + i);
                            if (self.n.at(property) & 0xff) != k::ObjectProperty {
                                break 'c2;
                            }
                            let vk = self.n.at(self.n.at(property + 5)) & 0xff;
                            if vk == k::ObjectPattern || vk == k::ArrayPattern {
                                should_break = true;
                                break 'l1;
                            }
                        }
                        i += 1;
                    }
                }
            }
        } else {
            should_break = self.options.object_wrap_preserve
                && self.has_newline_in_range(self.n.at(n + 1), self.n.at(self.n.at(list + 1) + 1));
        }
        let mut with_group = true;
        if is_pattern {
            if IS_FUNCTION_LIKE.at(pk) != 0 {
                let has_decorators = (self.n.at(n) & F_EXT) != 0 && self.n.at(self.n.at(n + 6)) > 0;
                if !has_decorators
                    && self.n.at(parent + 5) != n
                    && self.n.at(parent + 4) != n
                    && self.should_hug_the_only_function_parameter(parent)
                {
                    with_group = false;
                }
            } else if (pk == k::AssignmentExpression || pk == k::VariableDeclarator)
                && !should_break
            {
                with_group = false;
            }
        }
        if (self.n.at(n) & (F_EXT | F_OPTIONAL)) == 0 {
            self.print_members(n, list, should_break, with_group)?;
            return Ok(());
        }
        let g = if with_group { self.group_open() } else { 0 };
        self.print_members(n, list, false, false)?;
        self.print_binding_suffix(n, self.n.at(n) & 0xff)?;
        if with_group {
            self.group_close_with(g, should_break, 0);
            self.stays_expanded(g);
        }
        Ok(())
    }
}

/// `String(Number(text)) === text` for digits with or without a fraction. `None`: that takes more than counting digits.
fn simple_number_round_trips(text: &[u8]) -> Option<bool> {
    let (whole, fraction) = match bun_core::strings::index_of_char_usize(text, b'.') {
        Some(dot) => (text.get(..dot).unwrap_or(&[]), text.get(dot + 1..)),
        None => (text, None),
    };
    if whole.is_empty() || (whole.len() > 1 && whole.first() == Some(&b'0')) {
        return Some(false);
    }
    // from 1e21 on, and below 1e-6, the value is written with an exponent
    if whole.len() > 21 {
        return Some(false);
    }
    let zeros_at_start = |digits: &[u8]| digits.iter().take_while(|&&c| c == b'0').count();
    let zeros_at_end = |digits: &[u8]| digits.iter().rev().take_while(|&&c| c == b'0').count();
    let significant = match fraction {
        None => whole.len() - zeros_at_end(whole).min(whole.len() - 1),
        Some(fraction) => {
            if fraction.is_empty() || fraction.last() == Some(&b'0') {
                return Some(false);
            }
            if whole == b"0" {
                if zeros_at_start(fraction) >= 6 {
                    return Some(false);
                }
                fraction.len() - zeros_at_start(fraction)
            } else {
                whole.len() + fraction.len()
            }
        }
    };
    // Fifteen digits survive the way to a double and back, more than seventeen never do.
    match significant {
        0..=15 => Some(true),
        16 | 17 => None,
        _ => Some(false),
    }
}

impl Quick {
    fn round_trips_as_number(&self, start: i32, end: i32) -> R<bool> {
        simple_number_round_trips(self.t.sub(start, end)).ok_or_else(|| self.stop(why::RARE))
    }

    /// `String(value) === printNumber(raw)`, and that is a simple number.
    fn number_is_printed_as_its_value(&self, start: i32, end: i32) -> R<bool> {
        let raw = self.t.sub(start, end);
        if !raw.iter().all(|&c| c.is_ascii_digit() || c == b'.')
            || bun_core::strings::count_char(raw, b'.') > 1
        {
            // an exponent, another base, separators
            return Err(self.stop(why::RARE));
        }
        // printNumber(): a digit in front of the dot, no zeros at the end of the fraction but for the first digit, no dot at the end
        let mut printed = Vec::with_capacity(raw.len() + 1);
        if raw.first() == Some(&b'.') {
            printed.push(b'0');
        }
        printed.extend_from_slice(raw);
        if let Some(dot) = bun_core::strings::index_of_char_usize(&printed, b'.') {
            while printed.len() > dot + 2 && printed.last() == Some(&b'0') {
                printed.pop();
            }
            if printed.len() == dot + 1 {
                printed.pop();
            }
        }
        simple_number_round_trips(&printed).ok_or_else(|| self.stop(why::RARE))
    }
}
