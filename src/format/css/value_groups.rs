//! Prettier's `print/comma-separated-value-group.js` and `print/parenthesized-value-group.js`.

use super::Parser as Syntax;
use super::doc::{Doc, dedent, docs, fill, group, group_with, hardline, if_break, indent, join, line_suffix};
use super::misc::is_next_line_empty;
use super::postcss::Kind;
use super::printer::{Printer, is_at_word_placeholder, is_list_with_comma_group};
use super::text;
use super::value_parser::{ValueKind, ValueNode};

fn is_operator(node: &ValueNode<'_>, operator: u8) -> bool {
    matches!(&node.kind, ValueKind::Operator(value) if **value == [operator])
}

fn is_multiplication(node: &ValueNode<'_>) -> bool {
    is_operator(node, b'*')
}

fn is_division(node: &ValueNode<'_>) -> bool {
    is_operator(node, b'/')
}

fn is_addition(node: &ValueNode<'_>) -> bool {
    is_operator(node, b'+')
}

fn is_subtraction(node: &ValueNode<'_>) -> bool {
    is_operator(node, b'-')
}

fn is_math_operator(node: &ValueNode<'_>) -> bool {
    is_multiplication(node) || is_division(node) || is_addition(node) || is_subtraction(node) || is_operator(node, b'%')
}

fn word<'t>(node: &'t ValueNode<'_>) -> Option<&'t [u8]> {
    match &node.kind {
        ValueKind::Word { value, .. } => Some(value),
        _ => None,
    }
}

fn is_the_word(node: &ValueNode<'_>, text: &[u8]) -> bool {
    word(node) == Some(text)
}

fn is_one_of_the_words(node: &ValueNode<'_>, words: &[&[u8]]) -> bool {
    word(node).is_some_and(|it| words.contains(&it))
}

/// `isWordNode`
fn is_word_or_at_word(node: &ValueNode<'_>) -> bool {
    matches!(node.kind, ValueKind::Word { .. } | ValueKind::AtWord(_))
}

fn is_func(node: &ValueNode<'_>) -> bool {
    matches!(node.kind, ValueKind::Func { .. })
}

fn is_colon(node: &ValueNode<'_>) -> bool {
    matches!(node.kind, ValueKind::Colon)
}

fn is_comment(node: &ValueNode<'_>) -> bool {
    matches!(node.kind, ValueKind::Comment { .. })
}

fn is_inline_comment(node: &ValueNode<'_>) -> bool {
    matches!(node.kind, ValueKind::Comment { inline: true, .. })
}

fn has_empty_raw_before(node: &ValueNode<'_>) -> bool {
    node.before.as_ref().is_some_and(|before| before.is_empty())
}

/// `isParenGroupNode`: the `(`, if it is one.
fn paren_group_open<'t, 'a>(node: &'t ValueNode<'a>) -> Option<&'t ValueNode<'a>> {
    match &node.kind {
        ValueKind::ParenGroup {
            open: Some(open),
            close: Some(_),
            ..
        } => Some(open),
        _ => None,
    }
}

fn ends_where_starts(a: &ValueNode<'_>, b: &ValueNode<'_>) -> bool {
    a.loc.end_offset.is_some() && a.loc.end_offset == b.loc.start_offset
}

/// `isColorAdjusterFuncNode`
fn is_color_adjuster_func(node: &ValueNode<'_>) -> bool {
    const NAMES: [&[u8]; 25] = [
        b"red", b"green", b"blue", b"alpha", b"a", b"rgb", b"hue", b"h", b"saturation", b"s", b"lightness", b"l",
        b"whiteness", b"w", b"blackness", b"b", b"tint", b"shade", b"blend", b"blenda", b"contrast", b"hsl", b"hsla",
        b"hwb", b"hwba",
    ];
    matches!(&node.kind, ValueKind::Func { value, .. } if NAMES.iter().any(|name| text::eq_lower_case(value, name)))
}

fn is_possible_font_size(node: Option<&ValueNode<'_>>) -> bool {
    match node.map(|it| &it.kind) {
        Some(ValueKind::Number { .. }) => true,
        Some(ValueKind::Func { value, .. }) => {
            let value = value.to_ascii_lowercase();
            matches!(&value[..], b"var" | b"calc" | b"min" | b"max" | b"clamp") || value.starts_with(b"--")
        }
        _ => false,
    }
}

/// `isKeyValuePairNode`
fn is_key_value_pair(node: &ValueNode<'_>) -> bool {
    matches!(&node.kind, ValueKind::CommaGroup { groups } if groups.get(1).is_some_and(is_colon))
}

/// `isKeyValuePairInParenGroupNode`
fn is_key_value_pair_in_paren_group(node: &ValueNode<'_>) -> bool {
    matches!(&node.kind, ValueKind::ParenGroup { groups, .. } if groups.first().is_some_and(is_key_value_pair))
}

/// Adds `doc` to the last of `parts`: `parts.push([parts.pop(), doc])`.
fn append<'t>(parts: &mut Vec<Doc<'t>>, doc: Doc<'t>) {
    match parts.last_mut() {
        Some(Doc::Array(last)) => last.push(doc),
        Some(last) if last.is_empty_text() => *last = Doc::Array(vec![doc]),
        Some(last) => {
            let first = std::mem::replace(last, Doc::EMPTY);
            *last = Doc::Array(vec![first, doc]);
        }
        None => parts.push(doc),
    }
}

/// `parts.push(separator, "")`
fn separate<'t>(parts: &mut Vec<Doc<'t>>, separator: Doc<'t>) {
    parts.push(separator);
    parts.push(Doc::EMPTY);
}

impl<'t, 'a: 't> Printer<'t, 'a> {
    /// `getPropOfDeclNode`
    fn prop_of_declaration(&self) -> Option<Vec<u8>> {
        self.css_ancestor(Kind::Decl).map(|node| text::to_lower_case(&node.prop).into_owned())
    }

    pub(crate) fn print_comma_separated_value_group(&mut self, node: &'t ValueNode<'a>) -> Doc<'t> {
        let groups = node.groups().unwrap_or_default();
        let parent = self.value_stack.last().copied();
        let grandparent = self.value_stack.len().checked_sub(2).and_then(|at| self.value_stack.get(at)).copied();
        let declaration_prop = self.prop_of_declaration();
        let is_grid_value = matches!(parent.map(|it| &it.kind), Some(ValueKind::Value { .. }))
            && declaration_prop.as_ref().is_some_and(|prop| prop == b"grid" || prop.starts_with(b"grid-template"));
        let at_rule = self.css_ancestor(Kind::AtRule);
        let is_control_directive = at_rule.is_some_and(|it| self.is_scss_control_directive(it));
        let has_inline_comment = groups.iter().any(is_inline_comment);
        let is_in_paren_group = matches!(parent.map(|it| &it.kind), Some(ValueKind::ParenGroup { .. }));

        self.value_stack.push(node);
        let mut printed: Vec<Doc<'t>> = Vec::with_capacity(groups.len());
        for (index, child) in groups.iter().enumerate() {
            let previous = index.checked_sub(1).and_then(|at| groups.get(at));
            printed.push(self.print_value(child, previous));
        }
        self.value_stack.pop();
        // What asks about the functions around it asks about those around the group.
        let inside_url = self.inside_value_function(b"url");
        let inside_calc = self.inside_value_function(b"calc");
        let inside_type = self.inside_value_function(b"type");
        let is_in_scss_if = self.syntax == Syntax::Scss
            && is_in_paren_group
            && matches!(grandparent.map(|it| &it.kind), Some(ValueKind::Func { value, .. }) if **value == *b"if");

        // Content and separators take turns, and the first and the last are content.
        let mut parts: Vec<Doc<'t>> = vec![Doc::EMPTY];
        let mut inside_scss_interpolation_in_string = false;
        let mut did_break = false;

        for (i, printed) in printed.into_iter().enumerate() {
            let prev_node = i.checked_sub(1).and_then(|at| groups.get(at));
            let i_node = &groups[i];
            let next_node = groups.get(i + 1);

            if is_inline_comment(i_node) && next_node.is_none() {
                append(&mut parts, line_suffix(docs![" ", printed]));
                continue;
            }
            append(&mut parts, printed);

            if inside_url {
                if next_node.is_some_and(is_addition) || is_addition(i_node) {
                    append(&mut parts, Doc::from(" "));
                }
                continue;
            }

            // The wildcard of `@forward .. as a-*`.
            if self.inside_at_rule(&[b"forward"])
                && word(i_node).is_some_and(|it| !it.is_empty())
                && prev_node.is_some_and(|it| is_the_word(it, b"as"))
                && next_node.is_some_and(is_multiplication)
            {
                continue;
            }
            // `@utility a-*` of Tailwind.
            if self.inside_at_rule(&[b"utility"]) && word(i_node).is_some() && next_node.is_some_and(is_multiplication) {
                continue;
            }
            let Some(next_node) = next_node else {
                continue;
            };
            // `if(condition: value; else: value)`
            if is_in_scss_if && is_the_word(next_node, b";") {
                continue;
            }
            if word(i_node).is_some() && is_at_word_placeholder(next_node) && ends_where_starts(i_node, next_node) {
                continue;
            }

            // `"#{my-fn("_")}"`
            if let ValueKind::String { value, .. } = &i_node.kind {
                let opening = bun_core::strings::last_index_of(value, b"#{");
                let closing = bun_core::strings::last_index_of_char(value, b'}');
                match (opening, closing) {
                    (Some(opening), Some(closing)) => inside_scss_interpolation_in_string = opening > closing,
                    (Some(_), None) => inside_scss_interpolation_in_string = true,
                    (None, Some(_)) => inside_scss_interpolation_in_string = false,
                    (None, None) => {}
                }
            }
            if inside_scss_interpolation_in_string {
                continue;
            }

            if is_colon(i_node) || is_colon(next_node) {
                continue;
            }
            // `@@var`, `@var[ @notVarNested ][notVar]` in Less.
            if matches!(&i_node.kind, ValueKind::AtWord(value) if value.is_empty() || value.ends_with(b"[")) {
                continue;
            }
            if word(next_node).is_some_and(|it| it.starts_with(b"]")) {
                continue;
            }
            // `~"escaped"` in Less.
            if i_node.value() == Some(b"~") {
                continue;
            }
            if self.syntax == Syntax::Less {
                if is_the_word(next_node, b"[") {
                    continue;
                }
                if word(i_node).is_some_and(|it| it.ends_with(b"[")) && is_word_or_at_word(next_node) {
                    continue;
                }
            }

            let i_value = i_node.value().filter(|it| !it.is_empty());
            if !matches!(i_node.kind, ValueKind::String { .. })
                && i_value.is_some_and(|it| bun_core::strings::contains_char(it, b'\\'))
                && !is_comment(next_node)
            {
                continue;
            }
            // An escaped `/`.
            if prev_node.and_then(ValueNode::value).is_some_and(|it| {
                !it.is_empty() && bun_core::strings::index_of_char_usize(it, b'\\') == Some(it.len() - 1)
            }) && is_division(i_node)
            {
                continue;
            }
            if i_node.value() == Some(b"\\") {
                continue;
            }
            // `isPostcssSimpleVarNode`: `$$(style)Color`
            if is_func(i_node)
                && i_node.value() == Some(b"$$")
                && word(next_node).is_some()
                && next_node.before.as_ref().is_none_or(|it| it.is_empty())
            {
                continue;
            }

            // `#{variable}`
            let is_hash = |node: &ValueNode<'_>| is_the_word(node, b"#");
            let is_left_brace = |node: &ValueNode<'_>| is_the_word(node, b"{");
            let is_right_brace = |node: &ValueNode<'_>| is_the_word(node, b"}");
            if is_hash(i_node)
                || is_left_brace(i_node)
                || is_right_brace(next_node)
                || (is_left_brace(next_node) && has_empty_raw_before(next_node))
                || (is_right_brace(i_node) && has_empty_raw_before(next_node))
            {
                continue;
            }
            // `--#{$var}`
            if i_node.value() == Some(b"--") && is_hash(next_node) {
                continue;
            }

            let is_math = is_math_operator(i_node);
            let is_next_math = is_math_operator(next_node);

            // Next to an interpolation, the spaces around an operator stay as they are.
            if ((is_math && is_hash(next_node)) || (is_next_math && is_right_brace(i_node))) && has_empty_raw_before(next_node) {
                continue;
            }
            // `type(<number>+)`
            if is_addition(next_node) && inside_type && has_empty_raw_before(next_node) {
                continue;
            }
            // `-fb-url(/abs/path/)`
            if prev_node.is_none() && is_division(i_node) {
                continue;
            }
            // In `calc()`, the spaces around `+` and `-` stay as they are.
            if inside_calc
                && (is_addition(i_node) || is_addition(next_node) || is_subtraction(i_node) || is_subtraction(next_node))
                && has_empty_raw_before(next_node)
            {
                continue;
            }
            // A unary minus before a function.
            if self.syntax == Syntax::Scss
                && is_math
                && is_subtraction(i_node)
                && is_func(next_node)
                && !ends_where_starts(i_node, next_node)
            {
                append(&mut parts, Doc::from(" "));
                continue;
            }

            let next_next_node = groups.get(i + 2);

            // `color(red l(+ 20%))`
            let is_color_adjuster = (is_addition(i_node) || is_subtraction(i_node))
                && i == 0
                && matches!(next_node.kind, ValueKind::Number { .. } | ValueKind::Word { is_hex: true, .. })
                && grandparent.is_some_and(is_color_adjuster_func)
                && !has_empty_raw_before(next_node);
            let is_func_or_word = |node: &ValueNode<'_>| is_func(node) || is_word_or_at_word(node);
            let require_space_before_operator = next_next_node.is_some_and(is_func_or_word) || is_func_or_word(i_node);
            let require_space_after_operator = is_func_or_word(next_node) || prev_node.is_some_and(is_func_or_word);

            // `/`, `+`, `-`
            if !(is_multiplication(next_node) || is_multiplication(i_node))
                && !inside_calc
                && !is_color_adjuster
                && ((is_division(next_node) && !require_space_before_operator)
                    || (is_division(i_node) && !require_space_after_operator)
                    || (is_addition(next_node) && !require_space_before_operator)
                    || (is_addition(i_node) && !require_space_after_operator)
                    || is_subtraction(next_node)
                    || is_subtraction(i_node))
                && (has_empty_raw_before(next_node) || (is_math && prev_node.is_none_or(is_math_operator)))
            {
                continue;
            }

            // `-(`
            if matches!(self.syntax, Syntax::Scss | Syntax::Less)
                && is_math
                && is_subtraction(i_node)
                && paren_group_open(next_node).is_some_and(|open| ends_where_starts(i_node, open))
            {
                continue;
            }

            if is_inline_comment(i_node) {
                separate(&mut parts, if is_in_paren_group { dedent(hardline()) } else { hardline() });
                continue;
            }

            // The keywords of `@if`, `@each`, `@for`.
            if is_control_directive
                && (is_one_of_the_words(next_node, &[b"==", b"!="])
                    || is_one_of_the_words(next_node, &[b"<", b">", b"<=", b">="])
                    || is_one_of_the_words(next_node, &[b"and", b"or", b"not"])
                    || is_the_word(i_node, b"in")
                    || is_one_of_the_words(i_node, &[b"from", b"through", b"end"]))
            {
                append(&mut parts, Doc::from(" "));
                continue;
            }

            if at_rule.is_some_and(|it| text::eq_lower_case(it.name, b"namespace")) {
                append(&mut parts, Doc::from(" "));
                continue;
            }

            if is_grid_value {
                if i_node.has_source() && next_node.has_source() && i_node.loc.start_line != next_node.loc.start_line {
                    separate(&mut parts, hardline());
                    did_break = true;
                } else {
                    append(&mut parts, Doc::from(" "));
                }
                continue;
            }

            // `font: 12px/1.5 a`
            if declaration_prop.as_ref().is_some_and(|prop| prop == b"font" || prop.starts_with(b"--")) {
                if is_division(next_node) && has_empty_raw_before(next_node) && is_possible_font_size(Some(i_node)) {
                    continue;
                }
                if is_division(i_node) && has_empty_raw_before(i_node) && is_possible_font_size(prev_node) {
                    continue;
                }
            }

            if is_next_math {
                append(&mut parts, Doc::from(" "));
                continue;
            }
            // `function(returns-list($list)...)`
            if next_node.value() == Some(b"...") {
                continue;
            }
            if is_at_word_placeholder(i_node) && is_at_word_placeholder(next_node) && ends_where_starts(i_node, next_node) {
                continue;
            }
            if is_at_word_placeholder(i_node) && paren_group_open(next_node).is_some_and(|open| ends_where_starts(i_node, open)) {
                separate(&mut parts, Doc::SOFTLINE);
                continue;
            }
            if i_node.value() == Some(b"with") && paren_group_open(next_node).is_some() {
                parts = vec![docs![fill(std::mem::take(&mut parts)), " "]];
                continue;
            }
            // `--a#{(1) + 2}`
            if i_node.value().is_some_and(|it| it.ends_with(b"#"))
                && matches!(&next_node.kind, ValueKind::Func { value, group }
                    if **value == *b"{" && paren_group_open(group).is_some())
            {
                continue;
            }

            // It is printed at the end of the line, with the space before it.
            if is_inline_comment(next_node) && next_next_node.is_none() {
                continue;
            }
            // The value is in line with the block comments before it.
            if at_rule.is_none()
                && matches!(i_node.kind, ValueKind::Comment { inline: false, .. })
                && groups[..i].iter().all(is_comment)
            {
                separate(&mut parts, dedent(Doc::LINE));
                continue;
            }
            separate(&mut parts, Doc::LINE);
        }

        if has_inline_comment {
            append(&mut parts, Doc::BreakParent);
        }
        if did_break {
            parts.splice(0..0, [Doc::EMPTY, hardline()]);
        }
        if is_control_directive {
            return group(indent(parts));
        }
        // `insideURLFunctionInImportAtRuleNode`: `@import url("very long") projection,tv`
        if groups.len() == 2
            && groups[0].value() == Some(b"url")
            && self.css_ancestor(Kind::AtRule).is_some_and(|it| it.name == b"import")
        {
            return group(fill(parts));
        }
        group(indent(fill(parts)))
    }

    /// `isSCSSMapItemNode`, for `node`, which is in `self.value_stack`.
    fn is_scss_map_item(&self, node: &ValueNode<'a>) -> bool {
        if self.syntax != Syntax::Scss {
            return false;
        }
        let groups = node.groups().unwrap_or_default();
        if groups.is_empty() {
            return false;
        }
        // `$key: (value)` is not a list.
        if paren_group_open(node).is_some() && groups.len() == 1 && !matches!(groups[0].kind, ValueKind::CommaGroup { .. }) {
            return false;
        }
        let parent = self.value_stack.last().copied();
        if matches!(parent.map(|it| &it.kind), Some(ValueKind::Func { value, .. }) if **value == *b"if") {
            return false;
        }
        let grandparent = self.value_stack.len().checked_sub(2).and_then(|at| self.value_stack.get(at)).copied();
        let is_in_pair = grandparent.is_some_and(is_key_value_pair_in_paren_group);
        if !is_key_value_pair_in_paren_group(node) && !is_in_pair {
            return false;
        }
        // `$map: (key: value, other-key: other-value)`
        if self.css_ancestor(Kind::Decl).is_some_and(|it| it.prop.starts_with(b"$")) {
            return true;
        }
        // `$map: (key: (value other-value other-other-value))`
        if is_in_pair {
            return !parent.and_then(ValueNode::groups).unwrap_or_default().iter().any(is_math_operator);
        }
        // `func((key: value, other-key: other-value))`
        grandparent.is_some_and(is_func)
    }

    /// `shouldBreakList`, for `node`, which is in `self.value_stack`.
    fn should_break_list(&self, node: &ValueNode<'a>) -> bool {
        is_list_with_comma_group(node)
            && self.is_top_level_of_value()
            && self.css_stack.last().is_some_and(|it| match it.kind {
                Kind::Decl => !it.prop.starts_with(b"--"),
                Kind::AtRule => it.variable,
                _ => false,
            })
    }

    /// Whether what is being printed is the `group` of the `group` of the root of a value.
    fn is_top_level_of_value(&self) -> bool {
        matches!(self.value_stack[..], [root, value]
            if matches!(root.kind, ValueKind::Root { .. }) && matches!(value.kind, ValueKind::Value { .. }))
    }

    pub(crate) fn print_parenthesized_value_group(&mut self, node: &'t ValueNode<'a>) -> Doc<'t> {
        let ValueKind::ParenGroup { open, close, groups } = &node.kind else {
            return Doc::EMPTY;
        };
        let parent = self.value_stack.last().copied();

        self.value_stack.push(node);
        let mut group_docs: Vec<Doc<'t>> = Vec::with_capacity(groups.len());
        for child in groups {
            group_docs.push(self.print_value(child, None));
        }
        let print_paren = |paren: &Option<Box<ValueNode<'a>>>| match paren.as_deref().map(|it| &it.kind) {
            Some(ValueKind::Paren(b'(')) => Doc::from("("),
            Some(_) => Doc::from(")"),
            None => Doc::EMPTY,
        };
        self.value_stack.pop();

        let is_url = matches!(parent.map(|it| &it.kind), Some(ValueKind::Func { value, .. }) if text::eq_lower_case(value, b"url"));
        if is_url
            && (groups.len() == 1
                || groups.first().and_then(ValueNode::groups).and_then(<[_]>::first).and_then(word).is_some_and(|it| {
                    matches!(groups[0].kind, ValueKind::CommaGroup { .. }) && it.starts_with(b"data:")
                }))
        {
            return docs![print_paren(open), join(&Doc::from(","), group_docs), print_paren(close)];
        }

        if open.is_none() {
            let force_hard_line = self.should_break_list(node);
            let count = group_docs.len();
            let with_comma: Vec<Doc<'t>> = group_docs
                .into_iter()
                .enumerate()
                .map(|(index, doc)| if index + 1 == count { docs![doc] } else { docs![doc, ","] })
                .collect();
            let parts = join(&if force_hard_line { hardline() } else { Doc::LINE }, with_comma);
            // `shouldPrecededBySoftline`
            let is_preceded_by_softline =
                self.is_top_level_of_value() && self.css_stack.last().is_some_and(|it| it.kind == Kind::Decl);
            return indent(match force_hard_line {
                true => docs![hardline(), parts],
                false => group(docs![if is_preceded_by_softline { Doc::SOFTLINE } else { Doc::EMPTY }, fill(parts)]),
            });
        }

        let is_var = matches!(parent.map(|it| &it.kind), Some(ValueKind::Func { value, .. }) if text::eq_lower_case(value, b"var"));
        let is_scss_map_item = self.is_scss_map_item(node);
        let count = groups.len();
        let mut parts: Vec<Doc<'t>> = Vec::with_capacity(count);
        for (index, (child, mut doc)) in groups.iter().zip(group_docs).enumerate() {
            let is_last = index + 1 == count;
            // A pair of a key and a value in parentheses is indented already.
            if is_key_value_pair(child)
                && let Some([first, _, third, ..]) = child.groups()
                && !matches!(first.kind, ValueKind::ParenGroup { .. })
                && matches!(third.kind, ValueKind::ParenGroup { .. })
                && matches!(&doc, Doc::Group { contents, .. }
                    if matches!(&**contents, Doc::Indent(contents) if matches!(**contents, Doc::Fill(_))))
            {
                doc = group(dedent(doc));
            }

            let mut child_parts = vec![doc];
            if !is_last {
                child_parts.push(Doc::from(","));
            } else {
                // `printTrailingComma`
                let has_comma = || {
                    let (Some(start), Some(end)) = (child.loc.start_offset, close.as_ref().and_then(|it| it.loc.start_offset))
                    else {
                        return false;
                    };
                    text::trim_end(self.text.get(start as usize..end as usize).unwrap_or_default()).ends_with(b",")
                };
                let is_only_comments = is_comment(child)
                    || matches!(&child.kind, ValueKind::CommaGroup { groups } if groups.iter().all(is_comment));
                if is_var && has_comma() {
                    child_parts.push(Doc::from(","));
                } else if !is_only_comments && self.trailing_comma && is_scss_map_item {
                    child_parts.push(if_break(","));
                }
            }

            if !is_last
                && let ValueKind::CommaGroup { groups } = &child.kind
                && let Some(last) = groups.last()
                && let Some(end) = last.loc.end_offset.filter(|_| last.has_source())
                && is_next_line_empty(self.text, end as usize)
            {
                child_parts.push(hardline());
            }
            parts.push(Doc::Array(child_parts));
        }

        // `isKeyInValuePairNode`
        let is_key = parent.is_some_and(|parent| {
            is_key_value_pair(parent)
                && parent.groups().is_some_and(|siblings| {
                    let index = siblings.iter().position(|it| std::ptr::eq(it, node));
                    index.and_then(|at| siblings.get(at + 1)).is_some_and(is_colon)
                })
        });
        // `isConfigurationNode`: `@use "a" with (..)`
        let is_configuration = close.is_some()
            && groups.iter().all(|it| matches!(it.kind, ValueKind::CommaGroup { .. }))
            && parent.is_some_and(|parent| {
                matches!(parent.kind, ValueKind::CommaGroup { .. })
                    && parent.groups().is_some_and(|siblings| {
                        let index = siblings.iter().position(|it| std::ptr::eq(it, node));
                        index.and_then(|at| at.checked_sub(1)).and_then(|at| siblings.get(at)).is_some_and(|it| is_the_word(it, b"with"))
                    })
            });
        let should_break = is_configuration || (is_scss_map_item && !is_key);
        let should_dedent = is_configuration || is_key;

        let doc = group_with(
            docs![
                print_paren(open),
                indent(docs![Doc::SOFTLINE, join(&Doc::LINE, parts)]),
                Doc::SOFTLINE,
                Doc::LineSuffixBoundary,
                print_paren(close),
            ],
            should_break,
        );
        if should_dedent { dedent(doc) } else { doc }
    }
}
