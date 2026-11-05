//! Template literals whose text is CSS, GraphQL, HTML or Markdown (language-js/embed/*).
//!
//! The doc of such a literal is written once, out of line, and kept under the node (the printers of calls and arrow functions
//! ask for its label before they decide on a layout, and may print an argument several times). How a guest runs: lang.rs;
//! how the `${}`s get into its output: holes.rs.

use crate::ast::{F_CHAIN, F_COMPUTED, F_ESCAPE, k};
use crate::doc::{LABEL_EMBED, LABEL_EMBED_NO_HUG, op};
use crate::holes::{FILTER_BACKTICK, FILTER_END_OF_LINE, FILTER_UNCOOK};
use crate::lang::{GUEST_BETWEEN_LINES, lang};
use crate::options::WHITESPACE_IGNORE;
use crate::print::statics::{BACKQUOTE, SPACE};
use crate::{Quick, R, Words, why, zeros};

pub(crate) struct PrintEmbed {
    /// the docs of the expressions of the literal that is being printed
    pub(crate) ex: Vec<i32>,
    pub(crate) ex_top: i32,
    // ---------------------------------------------------------------------------------------------------------- GraphQL
    pub(crate) part_count: i32,
}
impl PrintEmbed {
    pub(crate) fn new() -> Self {
        Self {
            ex: zeros(64),
            ex_top: 0,
            part_count: 0,
        }
    }
}

pub(crate) const EMBED_NONE: i32 = 0;
pub(crate) const EMBED_CSS: i32 = 1;
pub(crate) const EMBED_GRAPHQL: i32 = 2;
pub(crate) const EMBED_HTML: i32 = 3;
pub(crate) const EMBED_ANGULAR: i32 = 4;
pub(crate) const EMBED_MARKDOWN: i32 = 5;
impl Quick {
    // ------------------------------------------------------------------------------------------------- which language?
    pub(crate) fn is_plain_member(&self, n: i32) -> bool {
        return (self.n.at(n) & (0xff | F_CHAIN)) == k::MemberExpression;
    }

    pub(crate) fn is_plain_call(&self, n: i32) -> bool {
        return (self.n.at(n) & (0xff | F_CHAIN)) == k::CallExpression;
    }

    pub(crate) fn is_styled_identifier(&self, n: i32) -> bool {
        return self.is_identifier_named(n, b"styled");
    }

    /// /^[A-Z]/.test(node.object.name) && node.property.name === "extend"
    pub(crate) fn is_styled_extend(&self, member: i32) -> bool {
        let object = self.n.at(member + 4);
        let property = self.n.at(member + 5);
        if (self.n.at(object) & 0xff) != k::Identifier {
            return false;
        }
        let c = self.t.at(self.n.at(object + 1));
        return c >= 65 && c <= 90 && self.is_named(property, b"extend");
    }

    /// node.name === word, for the kinds that have a name
    pub(crate) fn is_named(&self, n: i32, word: &[u8]) -> bool {
        let k = self.n.at(n) & 0xff;
        return (k == k::Identifier || k == k::JSXIdentifier) && self.name_is(n, word);
    }

    pub(crate) fn is_css_tag(&self, tag: i32) -> bool {
        // css, css.global, css.resolve
        if self.is_identifier_named(tag, b"css") {
            return true;
        }
        if (self.n.at(tag) & (0xff | F_CHAIN | F_COMPUTED)) != k::MemberExpression
            || !self.is_identifier_named(self.n.at(tag + 4), b"css")
        {
            return false;
        }
        let property = self.n.at(tag + 5);
        return self.is_identifier_named(property, b"global")
            || self.is_identifier_named(property, b"resolve");
    }

    pub(crate) fn is_styled_jsx(&self, parent: i32) -> bool {
        let pk = self.n.at(parent) & 0xff;
        if pk == k::TaggedTemplateExpression {
            return self.is_css_tag(self.n.at(parent + 4));
        }
        if pk != k::JSXExpressionContainer {
            return false;
        }
        let element = self.n.at(parent + 3);
        if (self.n.at(element) & 0xff) != k::JSXElement {
            return false;
        }
        // a child, not an attribute's value: the parent of an attribute's container is the attribute
        let opening = self.n.at(element + 4);
        if (self.n.at(opening) & 0xff) == k::Ready {
            // fast.rs does not read the tags of <style>
            return false;
        }
        let name = self.n.at(opening + 4);
        if (self.n.at(name) & 0xff) != k::JSXIdentifier || !self.name_is(name, b"style") {
            return false;
        }
        let attributes = self.n.at(opening + 5);
        let mut i: i32 = 1;
        while i <= self.n.at(attributes) {
            'c1: {
                let attribute = self.n.at(attributes + i);
                if (self.n.at(attribute) & 0xff) != k::JSXAttribute {
                    break 'c1;
                }
                let attribute_name = self.n.at(attribute + 4);
                if (self.n.at(attribute_name) & 0xff) == k::JSXIdentifier
                    && self.name_is(attribute_name, b"jsx")
                {
                    return true;
                }
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn is_styled_components(&self, parent: i32) -> bool {
        if (self.n.at(parent) & 0xff) != k::TaggedTemplateExpression {
            return false;
        }
        let mut tag = self.n.at(parent + 4);
        if (self.n.at(tag) & 0xff) == k::ParenthesizedExpression {
            tag = self.n.at(tag + 4);
        }
        if self.is_plain_member(tag) {
            return self.is_styled_identifier(self.n.at(tag + 4)) || self.is_styled_extend(tag);
        }
        if self.is_plain_call(tag) {
            let callee = self.n.at(tag + 4);
            if self.is_styled_identifier(callee) {
                return true;
            }
            if !self.is_plain_member(callee) {
                return false;
            }
            let object = self.n.at(callee + 4);
            if self.is_plain_member(object) {
                return self.is_styled_identifier(self.n.at(object + 4))
                    || self.is_styled_extend(object);
            }
            return self.is_plain_call(object) && self.is_styled_identifier(self.n.at(object + 4));
        }
        return self.is_identifier_named(tag, b"css");
    }

    pub(crate) fn is_css_prop(&self, parent: i32) -> bool {
        if (self.n.at(parent) & 0xff) != k::JSXExpressionContainer {
            return false;
        }
        let attribute = self.n.at(parent + 3);
        if (self.n.at(attribute) & 0xff) != k::JSXAttribute {
            return false;
        }
        let name = self.n.at(attribute + 4);
        return (self.n.at(name) & 0xff) == k::JSXIdentifier && self.name_is(name, b"css");
    }

    /// Is `property` the property `name` of the object in `@Component({ .. })`, and `value` its value?
    pub(crate) fn is_angular_component_property(
        &self,
        property: i32,
        value: i32,
        name: &[u8],
    ) -> bool {
        if (self.n.at(property) & (0xff | F_COMPUTED)) != k::ObjectProperty
            || self.n.at(property + 5) != value
            || !self.is_identifier_named(self.n.at(property + 4), name)
        {
            return false;
        }
        let object = self.n.at(property + 3);
        if (self.n.at(object) & 0xff) != k::ObjectExpression {
            return false;
        }
        let call_expression = self.n.at(object + 3);
        if !self.is_plain_call(call_expression)
            || self.n.at(call_expression + 4) == object
            || !self.is_identifier_named(self.n.at(call_expression + 4), b"Component")
        {
            return false;
        }
        return (self.n.at(self.n.at(call_expression + 3)) & 0xff) == k::Decorator;
    }

    pub(crate) fn is_angular_component_styles(&self, n: i32, parent: i32) -> bool {
        if (self.n.at(parent) & 0xff) == k::ArrayExpression {
            return self.is_angular_component_property(self.n.at(parent + 3), parent, b"styles");
        }
        return self.is_angular_component_property(parent, n, b"styles");
    }

    /// A leading comment that is exactly `/* name *\/`.
    pub(crate) fn has_leading_block_comment_with_name(&self, n: i32, name: &[u8]) -> bool {
        let mut c = self.first_comment(n);
        while c >= 0 {
            'c1: {
                if !self.is_leading(c) || !self.is_block_comment(c) {
                    break 'c1;
                }
                let start = self.comment_start(c);
                if self.comment_end(c) - start != name.len() as i32 + 6
                    || self.t.at(start + 2) != 32
                    || self.t.at(start + 3 + name.len() as i32) != 32
                {
                    break 'c1;
                }
                let mut same = true;
                let mut i: i32 = 0;
                while i < (name.len() as i32) {
                    if self.t.at(start + 3 + i) != name.at(i) {
                        same = false;
                    }
                    i += 1;
                }
                if same {
                    return true;
                }
            }
            c = self.next_comment(c);
        }
        return false;
    }

    pub(crate) fn is_as_const_expression(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::AsExpression {
            return false;
        }
        let type_ = self.n.at(n + 5);
        return type_ == 0
            || ((self.n.at(type_) & 0xff) == k::TypeReference
                && self.is_identifier_named(self.n.at(type_ + 4), b"const"));
    }

    pub(crate) fn has_language_comment(&self, n: i32, parent: i32, name: &[u8]) -> bool {
        return self.has_leading_block_comment_with_name(n, name)
            || (((self.n.at(parent) & 0xff) == k::ExpressionStatement
                || self.is_as_const_expression(parent))
                && self.has_leading_block_comment_with_name(parent, name));
    }

    pub(crate) fn is_embed_graph_ql(&self, n: i32, parent: i32) -> bool {
        if self.has_language_comment(n, parent, b"GraphQL") {
            return true;
        }
        if (self.n.at(parent) & 0xff) == k::TaggedTemplateExpression {
            let tag = self.n.at(parent + 4);
            if self.is_plain_member(tag) {
                return self.is_named(self.n.at(tag + 4), b"graphql")
                    && self.is_named(self.n.at(tag + 5), b"experimental");
            }
            return self.is_identifier_named(tag, b"gql")
                || self.is_identifier_named(tag, b"graphql");
        }
        // `graphql?.()` too, as with the tree of TypeScript.
        return (self.n.at(parent) & 0xff) == k::CallExpression
            && self.is_identifier_named(self.n.at(parent + 4), b"graphql");
    }

    pub(crate) fn embed_kind_of(&self, n: i32) -> i32 {
        let parent = self.n.at(n + 3);
        if self.is_styled_jsx(parent)
            || self.is_styled_components(parent)
            || self.is_css_prop(parent)
            || self.is_angular_component_styles(n, parent)
        {
            return EMBED_CSS;
        }
        if self.is_embed_graph_ql(n, parent) {
            return EMBED_GRAPHQL;
        }
        let is_tagged = (self.n.at(parent) & 0xff) == k::TaggedTemplateExpression;
        if self.has_language_comment(n, parent, b"HTML")
            || (is_tagged && self.is_identifier_named(self.n.at(parent + 4), b"html"))
        {
            return EMBED_HTML;
        }
        if self.is_angular_component_property(parent, n, b"template") {
            return EMBED_ANGULAR;
        }
        if is_tagged
            && self.n.at(self.n.at(n + 4)) == 1
            && (self.is_identifier_named(self.n.at(parent + 4), b"md")
                || self.is_identifier_named(self.n.at(parent + 4), b"markdown"))
        {
            return EMBED_MARKDOWN;
        }
        return EMBED_NONE;
    }

    /// The long way asks one language after the other, so a template that the first one does not read goes to the next one that its tag or a comment names.
    /// For Prettier the first one is the only one.
    fn is_in_a_second_language(&self, n: i32, kind: i32) -> bool {
        let parent = self.n.at(n + 3);
        let tag = self.n.at(parent + 4);
        return match kind {
            EMBED_CSS => self.is_embed_graph_ql(n, parent),
            EMBED_GRAPHQL | EMBED_HTML => {
                (self.n.at(parent) & 0xff) == k::TaggedTemplateExpression
                    && (self.is_identifier_named(tag, b"md")
                        || self.is_identifier_named(tag, b"markdown"))
            }
            _ => false,
        };
    }
}
// --------------------------------------------------------------------------------------------------------- the text
pub(crate) fn print_embed_hex_value(c: i32) -> i32 {
    return if c <= 57 { c - 48 } else { (c | 32) - 87 };
}

pub(crate) fn is_hex(c: i32) -> bool {
    return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

impl Quick {
    pub(crate) fn has_backslash(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end {
            if self.t.at(p) == 92 {
                return true;
            }
            p += 1;
        }
        return false;
    }

    /// Would `cooked` be null?
    pub(crate) fn has_invalid_escape(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end {
            'c1: {
                if self.t.at(p) != 92 {
                    break 'c1;
                }
                p += 1;
                let c = self.t.at(p);
                if c == 120 {
                    if !is_hex(self.t.at(p + 1)) || !is_hex(self.t.at(p + 2)) {
                        return true;
                    }
                } else if c == 117 {
                    if self.t.at(p + 1) == 123 {
                        let mut q = p + 2;
                        let mut value: i32 = 0;
                        while is_hex(self.t.at(q)) {
                            value = value * 16 + print_embed_hex_value(self.t.at(q));
                            q += 1;
                        }
                        if q == p + 2 || self.t.at(q) != 125 || value > 0x10ffff {
                            return true;
                        }
                    } else if !is_hex(self.t.at(p + 1))
                        || !is_hex(self.t.at(p + 2))
                        || !is_hex(self.t.at(p + 3))
                        || !is_hex(self.t.at(p + 4))
                    {
                        return true;
                    }
                } else if c >= 49 && c <= 57 {
                    return true;
                } else if c == 48 && self.t.at(p + 1) >= 48 && self.t.at(p + 1) <= 57 {
                    return true;
                }
            }
            p += 1;
        }
        return false;
    }

    pub(crate) fn gen_code_point(&mut self, cp: i32) {
        if cp < 0x80 {
            self.gen_byte(cp);
        } else if cp < 0x800 {
            self.gen_byte(0xc0 | (cp >> 6));
            self.gen_byte(0x80 | (cp & 63));
        } else if cp < 0x10000 {
            self.gen_byte(0xe0 | (cp >> 12));
            self.gen_byte(0x80 | ((cp >> 6) & 63));
            self.gen_byte(0x80 | (cp & 63));
        } else {
            self.gen_byte(0xf0 | (cp >> 18));
            self.gen_byte(0x80 | ((cp >> 12) & 63));
            self.gen_byte(0x80 | ((cp >> 6) & 63));
            self.gen_byte(0x80 | (cp & 63));
        }
    }

    pub(crate) fn hex_digits_value(&self, from: i32, to: i32) -> i32 {
        let mut value: i32 = 0;
        let mut p = from;
        while p < to {
            let c = self.t.at(p);
            value = (value << 4) | (if c <= 57 { c - 48 } else { (c | 32) - 87 });
            p += 1;
        }
        return value;
    }

    /// Appends the cooked value of the raw text T[start, end) to the generated area. There is room for it.
    pub(crate) fn gen_cooked(&mut self, start: i32, end: i32) {
        let mut p = start;
        while p < end {
            'c1: {
                let c = self.t.at(p);
                if c != 92 {
                    self.gen_byte(c);
                    break 'c1;
                }
                p += 1;
                let e = self.t.at(p);
                match e {
                    110 => {
                        self.gen_byte(10);
                    }
                    116 => {
                        self.gen_byte(9);
                    }
                    114 => {
                        self.gen_byte(13);
                    }
                    98 => {
                        self.gen_byte(8);
                    }
                    102 => {
                        self.gen_byte(12);
                    }
                    118 => {
                        self.gen_byte(11);
                    }
                    48 => {
                        self.gen_byte(0);
                    }
                    10 => {}
                    120 => {
                        self.gen_code_point(self.hex_digits_value(p + 1, p + 3));
                        p += 2;
                    }
                    117 => {
                        if self.t.at(p + 1) == 123 {
                            let mut q = p + 2;
                            while self.t.at(q) != 125 {
                                q += 1;
                            }
                            self.gen_code_point(self.hex_digits_value(p + 2, q));
                            p = q;
                        } else {
                            let mut cp = self.hex_digits_value(p + 1, p + 5);
                            p += 4;
                            // a surrogate pair is one code point
                            if cp >= 0xd800
                                && cp <= 0xdbff
                                && self.t.at(p + 1) == 92
                                && self.t.at(p + 2) == 117
                                && self.t.at(p + 3) != 123
                            {
                                let low = self.hex_digits_value(p + 3, p + 7);
                                if low >= 0xdc00 && low <= 0xdfff {
                                    cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
                                    p += 6;
                                }
                            }
                            self.gen_code_point(cp);
                        }
                    }
                    _ => {
                        self.gen_byte(e);
                    }
                }
            }
            p += 1;
        }
    }
}
pub(crate) fn is_space(c: i32) -> bool {
    return c == 32 || c == 9 || c == 10 || c == 13 || c == 11 || c == 12;
}

/// How many bytes the white space character of JavaScript takes that `text` starts with. 0 if it starts with none.
fn space_length(text: &[u8]) -> i32 {
    match text {
        [32 | 9..=13, ..] => 1,
        [0xc2, 0xa0, ..] => 2,
        [0xe1, 0x9a, 0x80, ..]
        | [0xe2, 0x80, 0x80..=0x8a | 0xa8 | 0xa9 | 0xaf, ..]
        | [0xe2, 0x81, 0x9f, ..]
        | [0xe3, 0x80, 0x80, ..]
        | [0xef, 0xbb, 0xbf, ..] => 3,
        _ => 0,
    }
}

impl Quick {
    /// `!text.trim()`
    pub(crate) fn print_embed_is_blank(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end {
            let length = space_length(self.t.sub(p, end));
            if length == 0 {
                return false;
            }
            p += length;
        }
        return true;
    }

    /// `/\s$/.test(text)`
    fn ends_with_space(&self, start: i32, end: i32) -> bool {
        (1..=3).any(|length| {
            end - length >= start && space_length(self.t.sub(end - length, end)) == length
        })
    }

    /// True if T[start, end) has white space that is neither a blank, a tab nor a line feed. The printers here and those of the long way do not agree on all of it.
    fn has_odd_space(&self, start: i32, end: i32) -> bool {
        let text = self.t.sub(start, end);
        (0..text.len()).any(|at| match text.get(at..) {
            Some([32 | 9 | 10, ..]) | None => false,
            Some(rest) => space_length(rest) != 0,
        })
    }

    /// True if an escape in T[start, end) has made half of a surrogate pair.
    fn has_lone_surrogate(&self, start: i32, end: i32) -> bool {
        (start..end - 1).any(|p| self.t.at(p) == 0xed && self.t.at(p + 1) >= 0xa0)
    }

    pub(crate) fn print_expressions(&mut self, n: i32) -> R<i32> {
        let quasis = self.n.at(n + 4);
        let expressions = self.n.at(n + 5);
        let count = self.n.at(expressions);
        let base = self.print_embed.ex_top;
        // The other language may write a line suffix in front of an expression.
        self.set_suffix_possible(true);
        if base + count > (self.print_embed.ex.len() as i32) {
            let mut grown = zeros::<i32>((base + count) * 2);
            grown.set_all(&self.print_embed.ex, 0);
            self.print_embed.ex = grown;
        }
        self.print_embed.ex_top = base + count;
        let mut i: i32 = 1;
        while i <= count {
            self.reserve();
            let h = self.detach_open();
            self.print_template_expression(
                self.n.at(expressions + i),
                self.n.at(quasis + i),
                self.n.at(quasis + i + 1),
                -1,
            )?;
            let v0 = base + i - 1;
            let v1 = self.detach_close(h);
            self.print_embed.ex.put(v0, v1);
            i += 1;
        }
        return Ok(base);
    }

    pub(crate) fn gen_decimal(&mut self, value: i32) -> R<()> {
        self.stack()?;
        if value >= 10 {
            self.gen_decimal(value / 10)?;
        }
        self.gen_byte(48 + value % 10);
        Ok(())
    }
}
// -------------------------------------------------------------------------------------------------------------- CSS
pub(crate) const CSS_PREFIX_TEXT: &[u8] = b"@prettier-placeholder-";
pub(crate) const CSS_PREFIX: i32 = 1752; // staticText(CSS_PREFIX_TEXT)
pub(crate) const CSS_SUFFIX: i32 = 1774; // staticText("-id")
impl Quick {
    pub(crate) fn print_embed_css(&mut self, n: i32) -> R<bool> {
        let quasis = self.n.at(n + 4);
        let count = self.n.at(quasis);
        self.text(BACKQUOTE);
        self.indent_hardline();
        let ok: bool;
        if count == 1 {
            let quasi = self.n.at(quasis + 1);
            ok = self.embed(lang::Scss, self.n.at(quasi + 1), self.n.at(quasi + 2))?;
        } else {
            let base = self.print_expressions(n)?;
            let from = self.gen_source_start(self.n.at(n + 2) - self.n.at(n + 1) + count * 40);
            let mut i: i32 = 1;
            while i <= count {
                let quasi = self.n.at(quasis + i);
                if i > 1 {
                    self.gen_copy(CSS_PREFIX, CSS_PREFIX + CSS_PREFIX_TEXT.len() as i32);
                    self.gen_decimal(i - 2)?;
                    self.gen_copy(CSS_SUFFIX, CSS_SUFFIX + 3);
                }
                self.gen_copy(self.n.at(quasi + 1), self.n.at(quasi + 2));
                i += 1;
            }
            let to = self.text.gen_pos;
            self.gen_source_end();
            self.begin_holes(
                count - 1,
                CSS_PREFIX,
                CSS_PREFIX_TEXT.len() as i32,
                CSS_SUFFIX,
                3,
                FILTER_END_OF_LINE,
            );
            let mut i: i32 = 0;
            while i < count - 1 {
                self.set_hole(i, self.print_embed.ex.at(base + i));
                i += 1;
            }
            ok = self.embed(lang::Scss, from, to)? && self.holes.holes_used == count - 1;
            self.end_holes();
            self.print_embed.ex_top = base;
        }
        if !ok {
            return Ok(false);
        }
        self.dedent_softline();
        self.text(BACKQUOTE);
        self.set_label(LABEL_EMBED);
        return Ok(true);
    }

    pub(crate) fn next_part(&mut self) {
        if self.print_embed.part_count != 0 {
            self.hardline();
        }
        self.print_embed.part_count += 1;
    }

    pub(crate) fn line_end(&self, mut p: i32, end: i32) -> i32 {
        while p < end && self.t.at(p) != 10 {
            p += 1;
        }
        return p;
    }

    /// /^\s*(?:#[^\n\r]*)?$/ for the line T[start, end)
    pub(crate) fn is_comment_or_blank_line(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end && is_space(self.t.at(p)) {
            p += 1;
        }
        if p == end {
            return true;
        }
        if self.t.at(p) != 35 {
            return false;
        }
        while p < end {
            if self.t.at(p) == 13 {
                return false;
            }
            p += 1;
        }
        return true;
    }

    /// print_graphql_comments(). Returns false if there is nothing but white space.
    pub(crate) fn print_graphql_comments(&mut self, start: i32, end: i32, dry_run: bool) -> bool {
        let mut seen_comment = false;
        let mut previous_was_blank = false;
        let mut p = start;
        loop {
            let e = self.line_end(p, end);
            let mut from = p;
            let mut to = e;
            while from < to && is_space(self.t.at(from)) {
                from += 1;
            }
            while to > from && is_space(self.t.at(to - 1)) {
                to -= 1;
            }
            if from != to {
                if dry_run {
                    return true;
                }
                if seen_comment {
                    self.hardline();
                }
                if previous_was_blank && seen_comment {
                    self.hardline();
                }
                self.slice_any(from, to);
                seen_comment = true;
            }
            previous_was_blank = from == to;
            if e >= end {
                break;
            }
            p = e + 1;
        }
        return seen_comment;
    }

    pub(crate) fn print_embed_graph_ql(&mut self, n: i32) -> R<bool> {
        let quasis = self.n.at(n + 4);
        let count = self.n.at(quasis);
        let base = self.print_expressions(n)?;
        let saved_parts = self.print_embed.part_count;
        self.print_embed.part_count = 0;
        self.text(BACKQUOTE);
        self.indent_hardline();
        let mut ok = true;
        let mut i: i32 = 1;
        while i <= count && ok {
            self.reserve();
            let quasi = self.n.at(quasis + i);
            let is_first = i == 1;
            let is_last = i == count;
            let mut start = self.n.at(quasi + 1);
            let mut end = self.n.at(quasi + 2);
            let escaped = self.has_backslash(start, end);
            if escaped {
                let from = self.gen_source_start(end - start);
                self.gen_cooked(start, end);
                start = from;
                end = self.text.gen_pos;
                self.gen_source_end();
                // no character of GraphQL
                if self.has_lone_surrogate(start, end) {
                    ok = false;
                    break;
                }
            }
            if self.has_odd_space(start, end) {
                return Err(self.stop(why::GUEST));
            }
            // the lines
            let mut lines: i32 = 1;
            let mut p = start;
            while p < end {
                if self.t.at(p) == 10 {
                    lines += 1;
                }
                p += 1;
            }
            let mut last_line = end;
            while last_line > start && self.t.at(last_line - 1) != 10 {
                last_line -= 1;
            }
            if !is_last {
                // an interpolation in a comment
                let mut in_comment = false;
                let mut p = last_line;
                while p < end {
                    if self.t.at(p) == 35 {
                        in_comment = true;
                    } else if self.t.at(p) == 13 {
                        in_comment = false;
                    }
                    p += 1;
                }
                if in_comment {
                    ok = false;
                    break;
                }
            }
            let mut starts_with_blank_line = false;
            let mut ends_with_blank_line = false;
            if lines > 2 {
                let first = self.line_end(start, end);
                starts_with_blank_line = self.print_embed_is_blank(start, first)
                    && self.print_embed_is_blank(first + 1, self.line_end(first + 1, end));
                let mut before = last_line - 1;
                while before > start && self.t.at(before - 1) != 10 {
                    before -= 1;
                }
                ends_with_blank_line = self.print_embed_is_blank(last_line, end)
                    && self.print_embed_is_blank(before, last_line - 1);
            }
            let mut comments_and_whitespace_only = true;
            let mut p = start;
            loop {
                let e = self.line_end(p, end);
                if !self.is_comment_or_blank_line(p, e) {
                    comments_and_whitespace_only = false;
                    break;
                }
                if e >= end {
                    break;
                }
                p = e + 1;
            }
            let has_doc =
                !comments_and_whitespace_only || self.print_graphql_comments(start, end, true);
            if has_doc {
                if !is_first && starts_with_blank_line {
                    self.next_part();
                }
                self.next_part();
                if escaped {
                    self.push_text_filter(FILTER_UNCOOK);
                }
                if comments_and_whitespace_only {
                    self.print_graphql_comments(start, end, false);
                } else {
                    ok = self.embed(lang::GraphQL, start, end)?;
                }
                if escaped {
                    self.pop_text_filter();
                }
                if !is_last && ends_with_blank_line {
                    self.next_part();
                }
            } else if !is_first && !is_last && starts_with_blank_line {
                self.next_part();
            }
            if !is_last {
                self.next_part();
                self.call(self.print_embed.ex.at(base + i - 1));
            }
            i += 1;
        }
        let parts = self.print_embed.part_count;
        self.print_embed.part_count = saved_parts;
        self.print_embed.ex_top = base;
        if !ok {
            return Ok(false);
        }
        // Two line breaks in a row, of which the long way prints one.
        if parts == 0 {
            return Err(self.stop(why::GUEST));
        }
        self.dedent_hardline();
        self.text(BACKQUOTE);
        self.set_label(LABEL_EMBED);
        return Ok(true);
    }
}
// ------------------------------------------------------------------------------------------------------------- HTML
pub(crate) const HTML_PREFIX_TEXT: &[u8] = b"PRETTIER_HTML_PLACEHOLDER_";
pub(crate) const HTML_PREFIX: i32 = 1777; // staticText(HTML_PREFIX_TEXT)
impl Quick {
    pub(crate) fn reset_embed(&mut self) {
        self.print_embed.ex_top = 0;
    }

    pub(crate) fn print_embed_html(&mut self, n: i32, language: i32) -> R<bool> {
        let quasis = self.n.at(n + 4);
        let count = self.n.at(quasis);
        let counter = 0;
        let base = self.print_expressions(n)?;
        // the suffix of the placeholders: _<counter>_IN_JS
        self.reserve_gen(32);
        let suffix = self.text.gen_pos;
        self.gen_byte(95);
        self.gen_decimal(counter)?;
        self.gen_string(b"_IN_JS");
        let suffix_length = self.text.gen_pos - suffix;
        let start: i32;
        let end: i32;
        let only = self.n.at(quasis + 1);
        if count == 1 && (self.n.at(only) & F_ESCAPE) == 0 {
            start = self.n.at(only + 1);
            end = self.n.at(only + 2);
        } else {
            start = self.gen_source_start(self.n.at(n + 2) - self.n.at(n + 1) + count * 64);
            let mut i: i32 = 1;
            while i <= count {
                let quasi = self.n.at(quasis + i);
                self.gen_cooked(self.n.at(quasi + 1), self.n.at(quasi + 2));
                if i < count {
                    self.gen_copy(HTML_PREFIX, HTML_PREFIX + HTML_PREFIX_TEXT.len() as i32);
                    self.gen_decimal(i - 1)?;
                    self.gen_copy(suffix, suffix + suffix_length);
                }
                i += 1;
            }
            end = self.text.gen_pos;
            self.gen_source_end();
        }
        let leading_whitespace = space_length(self.t.sub(start, end)) != 0;
        let trailing_whitespace = self.ends_with_space(start, end);
        let hard_break = self.options.html_whitespace_sensitivity == WHITESPACE_IGNORE;
        let has_linebreak = hard_break || (leading_whitespace && trailing_whitespace);
        let outer = self.group_open();
        self.text(BACKQUOTE);
        let mut indent_at: i32 = 0;
        if has_linebreak {
            self.indent_open();
            if hard_break {
                self.hardline();
            } else {
                self.line();
            }
        } else {
            if leading_whitespace {
                self.text(SPACE);
            }
            indent_at = self.nop();
        }
        let inner = self.group_open();
        self.begin_holes(
            count - 1,
            HTML_PREFIX,
            HTML_PREFIX_TEXT.len() as i32,
            suffix,
            suffix_length,
            FILTER_UNCOOK,
        );
        let mut i: i32 = 0;
        while i < count - 1 {
            self.set_hole(i, self.print_embed.ex.at(base + i));
            i += 1;
        }
        if has_linebreak && self.options.short_cuts {
            self.set_guest_column(GUEST_BETWEEN_LINES);
        }
        self.guest.template_at = self.n.at(n + 1);
        let ok = self.embed(language, start, end)?;
        self.end_holes();
        self.print_embed.ex_top = base;
        if !ok {
            return Ok(false);
        }
        self.group_close(inner);
        if has_linebreak {
            self.indent_close();
            if hard_break {
                self.hardline();
            } else {
                self.line();
            }
        } else {
            if self.lang.top_level_count > 1 {
                self.patch(indent_at, op::IndentOpen);
                self.indent_close();
            }
            if trailing_whitespace {
                self.text(SPACE);
            }
        }
        self.text(BACKQUOTE);
        self.group_close(outer);
        self.set_label(if has_linebreak {
            LABEL_EMBED
        } else {
            LABEL_EMBED_NO_HUG
        });
        return Ok(true);
    }

    // --------------------------------------------------------------------------------------------------------- Markdown
    pub(crate) fn print_embed_markdown(&mut self, n: i32) -> R<bool> {
        let quasi = self.n.at(self.n.at(n + 4) + 1);
        let raw_start = self.n.at(quasi + 1);
        let raw_end = self.n.at(quasi + 2);
        if self.has_odd_space(raw_start, raw_end) {
            return Err(self.stop(why::GUEST));
        }
        // /((?:\\\\)*)\\`/g -> half of the backslashes, and the backtick
        let mut start = self.gen_source_start(raw_end - raw_start);
        {
            let mut p = raw_start;
            while p < raw_end {
                'c1: {
                    if self.t.at(p) != 92 {
                        self.gen_byte(self.t.at(p));
                        break 'c1;
                    }
                    let mut q = p;
                    while q < raw_end && self.t.at(q) == 92 {
                        q += 1;
                    }
                    let run = q - p;
                    if q < raw_end && self.t.at(q) == 96 && (run & 1) == 1 {
                        let mut k = run >> 1;
                        while k > 0 {
                            self.gen_byte(92);
                            k -= 1;
                        }
                        self.gen_byte(96);
                        p = q;
                    } else {
                        let mut k = run;
                        while k > 0 {
                            self.gen_byte(92);
                            k -= 1;
                        }
                        p = q - 1;
                    }
                }
                p += 1;
            }
        }
        let mut end = self.text.gen_pos;
        self.gen_source_end();
        // getIndentation(): the white space before the first character that is none
        let mut indent_start = start;
        let mut indent_end = start;
        let mut p = start;
        while p < end {
            let e = self.line_end(p, end);
            let mut q = p;
            while q < e && is_space(self.t.at(q)) {
                q += 1;
            }
            if q < e {
                indent_start = p;
                indent_end = q;
                break;
            }
            p = e + 1;
        }
        let indent_length = indent_end - indent_start;
        if indent_length != 0 {
            let from = self.gen_source_start(end - start);
            let mut p = start;
            while p <= end {
                let e = self.line_end(p, end);
                let mut same = p + indent_length <= e || p + indent_length <= end;
                let mut i: i32 = 0;
                while i < indent_length && same {
                    if self.t.at(p + i) != self.t.at(indent_start + i) {
                        same = false;
                    }
                    i += 1;
                }
                let mut q = if same { p + indent_length } else { p };
                while q < e {
                    self.gen_byte(self.t.at(q));
                    q += 1;
                }
                if e >= end {
                    break;
                }
                self.gen_byte(10);
                p = e + 1;
            }
            start = from;
            end = self.text.gen_pos;
            self.gen_source_end();
        }
        self.text(BACKQUOTE);
        if indent_length != 0 {
            self.indent_softline();
        } else {
            self.literalline();
            self.dedent_to_root_open();
        }
        let saved = self.options.in_js_template;
        self.set_in_js_template(true);
        self.push_text_filter(FILTER_BACKTICK);
        let ok = self.embed(lang::Markdown, start, end)?;
        self.pop_text_filter();
        self.set_in_js_template(saved);
        if !ok {
            return Ok(false);
        }
        self.dedent_softline();
        self.text(BACKQUOTE);
        self.set_label(LABEL_EMBED);
        return Ok(true);
    }
}
// --------------------------------------------------------------------------------------------------------- the door
pub(crate) fn guest_of(kind: i32) -> i32 {
    match kind {
        EMBED_CSS => {
            return lang::Scss;
        }
        EMBED_GRAPHQL => {
            return lang::GraphQL;
        }
        EMBED_HTML => {
            return lang::Html;
        }
        EMBED_ANGULAR => {
            return lang::Angular;
        }
        _ => {}
    }
    return lang::Markdown;
}

impl Quick {
    /// The doc of the template literal `n` as embedded code, or -1 if it is none (or does not parse).
    pub(crate) fn embed_doc_of(&mut self, n: i32) -> R<i32> {
        let key = n.wrapping_neg();
        let cached = self.cache_get(key);
        if cached != 0 {
            return Ok(cached);
        }
        let mut doc: i32 = -1;
        let kind = self.embed_kind_of(n);
        if kind == EMBED_NONE {
            return Ok(-1);
        }
        if self.is_registered(guest_of(kind)) {
            let quasis = self.n.at(n + 4);
            let count = self.n.at(quasis);
            let mut valid = true;
            let mut i: i32 = 1;
            while i <= count {
                let quasi = self.n.at(quasis + i);
                if (self.n.at(quasi) & F_ESCAPE) != 0
                    && self.has_invalid_escape(self.n.at(quasi + 1), self.n.at(quasi + 2))
                {
                    valid = false;
                }
                i += 1;
            }
            if valid {
                let mark = self.checkpoint();
                let h = self.detach_open();
                let ok: bool;
                let first = self.n.at(quasis + 1);
                if count == 1
                    && self.print_embed_is_blank(self.n.at(first + 1), self.n.at(first + 2))
                {
                    self.text(BACKQUOTE);
                    self.text(BACKQUOTE);
                    self.set_label(0);
                    ok = true;
                } else if kind == EMBED_CSS {
                    ok = self.print_embed_css(n)?;
                } else if kind == EMBED_GRAPHQL {
                    ok = self.print_embed_graph_ql(n)?;
                } else if kind == EMBED_MARKDOWN {
                    ok = self.print_embed_markdown(n)?;
                } else {
                    ok = self.print_embed_html(
                        n,
                        if kind == EMBED_HTML {
                            lang::Html
                        } else {
                            lang::Angular
                        },
                    )?;
                }
                if ok {
                    doc = self.detach_close(h);
                    self.commit(mark);
                } else {
                    self.rollback(mark);
                    if self.is_in_a_second_language(n, kind) {
                        return Err(self.stop(why::GUEST));
                    }
                }
            }
        }
        self.cache_set(key, doc);
        return Ok(doc);
    }

    /// Prints the template literal `n` as embedded code, if it is that.
    pub(crate) fn print_embedded_template(&mut self, n: i32) -> R<bool> {
        if !self.options.embedded_language_formatting_auto {
            return Ok(false);
        }
        let doc = self.embed_doc_of(n)?;
        if doc < 0 {
            return Ok(false);
        }
        self.call(doc);
        return Ok(true);
    }

    /// doc.label of what print(n) gives: LABEL_EMBED, LABEL_EMBED_NO_HUG, or 0.
    pub(crate) fn embed_label_of(&mut self, mut n: i32) -> R<i32> {
        let k = self.n.at(n) & 0xff;
        if k == k::TaggedTemplateExpression {
            n = self.n.at(n + 5);
        } else if k != k::TemplateLiteral {
            return Ok(0);
        }
        if !self.options.embedded_language_formatting_auto {
            return Ok(0);
        }
        let doc = self.embed_doc_of(n)?;
        return Ok(if doc < 0 { 0 } else { self.doc_label(doc) });
    }
}
