//! Prettier's `language-html/parse/*.js`.

use super::Parser;
use super::ast::{Flags, Id, Kind, Node, Span, Tree};
use super::data;
use super::error::SyntaxError;
use super::lexer::{self, LexedAttribute};
use super::parser;
use super::utilities::is_unknown_namespace;
use crate::text;
use bun_core::strings;
use std::borrow::Cow;

#[derive(Debug, Copy, Clone)]
pub(crate) enum ParseError<'a> {
    Syntax(SyntaxError<'a>),
    NestedTooDeeply,
}

type Result<'a, T> = std::result::Result<T, ParseError<'a>>;

/// `ParseOptions`
#[derive(Copy, Clone)]
struct ParseOptions {
    name: Parser,
    normalize_tag_name: bool,
    normalize_attribute_name: bool,
    is_tag_name_case_sensitive: bool,
    lexer: lexer::Options,
}

fn parse_options(parser: Parser) -> ParseOptions {
    let html = ParseOptions {
        name: Parser::Html,
        normalize_tag_name: true,
        normalize_attribute_name: true,
        is_tag_name_case_sensitive: false,
        lexer: lexer::Options {
            can_self_close: true,
            allow_htm_component_closing_tags: true,
            ..lexer::Options::default()
        },
    };
    let other = ParseOptions {
        name: parser,
        normalize_tag_name: false,
        normalize_attribute_name: false,
        is_tag_name_case_sensitive: false,
        lexer: lexer::Options {
            can_self_close: true,
            ..lexer::Options::default()
        },
    };
    match parser {
        Parser::Html => html,
        Parser::Mjml => ParseOptions {
            name: Parser::Mjml,
            ..html
        },
        Parser::Angular => ParseOptions {
            lexer: lexer::Options {
                tokenize_angular_blocks: true,
                tokenize_let: true,
                allow_start_tag_comments: true,
                ..other.lexer
            },
            ..other
        },
        Parser::Vue => ParseOptions {
            is_tag_name_case_sensitive: true,
            ..other
        },
        Parser::Lwc => ParseOptions {
            lexer: lexer::Options::default(),
            ..other
        },
        // It is not parsed as HTML.
        Parser::AngularExpression(_) => other,
    }
}

fn should_parse_as_raw_text_in_mjml(
    tag_name: &[u8],
    _has_parent: bool,
    _attrs: &[LexedAttribute<'_>],
) -> bool {
    matches!(tag_name, b"mj-style" | b"mj-raw")
}

fn should_parse_as_raw_text_in_vue(
    tag_name: &[u8],
    has_parent: bool,
    attrs: &[LexedAttribute<'_>],
) -> bool {
    !tag_name.eq_ignore_ascii_case(b"html")
        && !has_parent
        && (tag_name != b"template"
            || attrs.iter().any(|attr| {
                attr.name == b"lang"
                    && attr
                        .value
                        .is_some_and(|value| !matches!(value, b"html" | b""))
            }))
}

struct Context<'a, 't> {
    /// The text that is parsed: with blanks in the place of the front matter.
    text: &'a [u8],
    tree: &'t mut Tree<'a>,
    /// Whether `parseVue` is the function that parses. The options can be those of HTML all the same.
    is_vue: bool,
    /// How many conditional comments are around what is parsed.
    depth: usize,
}

impl<'a> Context<'a, '_> {
    fn angular_html_parser_parse(
        &mut self,
        range: Span,
        options: &ParseOptions,
        decides_on_raw_text: bool,
    ) -> Result<'a, parser::ParseResult<'a>> {
        let should_parse_as_raw_text: Option<&dyn Fn(&[u8], bool, &[LexedAttribute<'_>]) -> bool> =
            match options.name {
                _ if !decides_on_raw_text => None,
                Parser::Mjml => Some(&should_parse_as_raw_text_in_mjml),
                Parser::Vue => Some(&should_parse_as_raw_text_in_vue),
                _ => None,
            };
        let result = parser::parse(
            self.tree,
            self.text.get(..range.end as usize).unwrap_or(self.text),
            range.start as usize,
            parser::Options {
                lexer: options.lexer,
                is_tag_name_case_sensitive: options.is_tag_name_case_sensitive,
                should_parse_as_raw_text,
            },
        );
        match result.is_nested_too_deeply {
            true => Err(ParseError::NestedTooDeeply),
            false => Ok(result),
        }
    }

    /// `parseHtml`. Returns what has the `rootNodes` as its children.
    fn parse_html(&mut self, range: Span, options: ParseOptions) -> Result<'a, (ParseOptions, Id)> {
        let result = self.angular_html_parser_parse(range, &options, true)?;
        match result.errors.first() {
            None => Ok((options, result.root)),
            Some(&error) => Err(ParseError::Syntax(error)),
        }
    }

    /// `parseVue`
    fn parse_vue(&mut self, range: Span, options: ParseOptions) -> Result<'a, (ParseOptions, Id)> {
        let parser::ParseResult { root, errors, .. } =
            self.angular_html_parser_parse(range, &options, true)?;
        // A void element at the top makes the errors those of the second result.
        let mut has_errors_of_second = false;
        let is_html = self.tree.children(root).any(|id| {
            let node = &self.tree[id];
            match node.kind {
                Kind::DocType => &node.value[..] == b"html",
                Kind::Element => {
                    node.namespace.is_empty() && node.name.eq_ignore_ascii_case(b"html")
                }
                _ => false,
            }
        });
        if is_html {
            return self.parse_html(range, parse_options(Parser::Html));
        }
        let mut second: Option<parser::ParseResult<'a>> = None;
        // The first error of the second result, before they are sorted.
        let mut first_of_second = None;
        // The first of what the second result has at the top that does not start before the element that is looked at.
        let mut candidate = None;
        let mut next = self.tree.first_child(root);
        while let Some(id) = next {
            next = self.tree.next(id);
            let node = &self.tree[id];
            if node.kind != Kind::Element {
                continue;
            }
            let (start_span, end_span) = (node.start_span, node.end_span());
            let is_plain = node.namespace.is_empty();
            let is_void = is_plain
                && parser::definition_of(&node.name, options.is_tag_name_case_sensitive).is_void;
            // `shouldParseVueRootNodeAsHtml`
            let is_html_template = is_plain && &node.name[..] == b"template" && {
                let language = self
                    .tree
                    .attrs(id)
                    .iter()
                    .find(|attr| attr.namespace.is_empty() && &attr.name[..] == b"lang");
                language.is_none_or(|attr| {
                    let value = attr.value_span.map_or(&b""[..], |span| span.of(self.text));
                    let value = match value {
                        [b'"' | b'\'', inner @ .., _] => inner,
                        _ => value,
                    };
                    matches!(value, b"" | b"html")
                })
            };
            if !is_void && !is_html_template {
                continue;
            }
            let second = match &second {
                Some(second) => second,
                None => {
                    let second =
                        second.insert(self.angular_html_parser_parse(range, &options, false)?);
                    first_of_second = second.errors.first().copied();
                    crate::sort::sort_by_key(&mut second.errors[..], |it| it.at);
                    candidate = self.tree.first_child(second.root);
                    &*second
                }
            };
            if is_void {
                has_errors_of_second = true;
            } else {
                // Without an end tag, Prettier fails when it asks where that ends.
                let first = second
                    .errors
                    .partition_point(|it| it.at <= start_span.start);
                let mut errors = (second.errors.get(first..).unwrap_or_default().iter())
                    .take_while(|it| end_span.is_none_or(|span| it.at < span.end));
                if let Some(&first) = errors.clone().next() {
                    let error = errors
                        .find(|it| it.kind.is_of_lexer())
                        .map_or(first, |it| *it);
                    return Err(ParseError::Syntax(error));
                }
            }
            // `getElementWithSameLocation`. Both lists are in the order of the text.
            while let Some(other) =
                candidate.filter(|&it| self.tree[it].span.start < start_span.start)
            {
                candidate = self.tree.next(other);
            }
            if let Some(same) = candidate.filter(|&it| {
                self.tree[it].kind == Kind::Element
                    && self.tree[it].start_span.start == start_span.start
            }) {
                candidate = self.tree.next(same);
                self.tree.remove(same);
                self.tree.replace(id, same);
            }
        }
        let error = match has_errors_of_second {
            true => first_of_second,
            false => errors.first().copied(),
        };
        match error {
            None => Ok((options, root)),
            Some(error) => Err(ParseError::Syntax(error)),
        }
    }

    /// `parse`, without the front matter. Returns what has the children of the root as its children.
    fn parse(&mut self, range: Span, options: ParseOptions) -> Result<'a, Id> {
        let (actual_options, root) = match self.is_vue {
            true => self.parse_vue(range, options)?,
            false => self.parse_html(range, options)?,
        };
        self.postprocess(root, actual_options)?;
        Ok(root)
    }

    /// What `postprocess` does with `id` itself.
    fn postprocess_node(&mut self, id: Id, options: ParseOptions) -> Result<'a, ()> {
        let text = self.text;
        match self.tree[id].kind {
            Kind::Element => self.postprocess_element(id, options),
            Kind::Comment => {
                let node = &mut self.tree[id];
                let source = node.span.of(text);
                node.value = Cow::Borrowed(
                    source
                        .get(4..source.len().saturating_sub(3))
                        .unwrap_or_default(),
                );
                self.parse_ie_conditional_comment(id, options)?;
            }
            Kind::Text => {
                let node = &mut self.tree[id];
                node.value = Cow::Borrowed(node.span.of(text));
            }
            Kind::AngularControlFlowBlock => {
                // `name.toLowerCase().replaceAll(/\s+/g, " ").trim()`
                let node = &mut self.tree[id];
                let is_normal = node.name.iter().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_'
                });
                if !is_normal && !matches!(&node.name[..], b"else if" | b"default never") {
                    node.name = Cow::Owned(collapse_white_space(&node.name.to_ascii_lowercase()));
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn postprocess_element(&mut self, id: Id, options: ParseOptions) {
        let text = self.text;
        // `restoreName`
        let restored = |namespace: &'a [u8], name_span: Span| {
            let raw_name = name_span.of(text);
            let explicit = match namespace {
                b"" => None,
                _ => raw_name
                    .strip_prefix(namespace)
                    .and_then(|rest| rest.strip_prefix(b":")),
            };
            (explicit.unwrap_or(raw_name), explicit.is_some())
        };
        let node = &mut self.tree[id];
        let (name, has_explicit_namespace) = restored(node.namespace, node.name_span);
        let old_name = std::mem::replace(&mut node.name, Cow::Borrowed(name));
        node.flags
            .set(Flags::HAS_EXPLICIT_NAMESPACE, has_explicit_namespace);
        // `addTagDefinition`. Without a namespace, the parser has looked for the same name.
        let definition = match node.namespace.is_empty() && *old_name == *name {
            true => node.tag_definition,
            false => parser::definition_of(name, options.is_tag_name_case_sensitive),
        };
        let is_plain = node.namespace.is_empty()
            || Some(node.namespace) == definition.implicit_namespace_prefix
            || is_unknown_namespace(node);
        node.tag_definition = if is_plain {
            definition
        } else {
            &data::DEFAULT_TAG_DEFINITION
        };
        // `normalizeName`
        if options.normalize_tag_name && is_plain && name.iter().any(u8::is_ascii_uppercase) {
            let lower = name.to_ascii_lowercase();
            if data::is_html_tag(&lower) {
                node.name = Cow::Owned(lower);
            }
        }
        let (start, end) = node.attrs;
        let Tree { nodes, attrs, .. } = &mut *self.tree;
        let element_name = &nodes[id as usize].name;
        for attr in attrs
            .get_mut(start as usize..end as usize)
            .unwrap_or_default()
        {
            // What Prettier takes for `:namespace:name` can be a name that starts with a colon: `::a` is `:a` without a prefix.
            if attr.namespace.is_empty()
                && let Cow::Borrowed([b':', rest @ ..]) = attr.name
            {
                attr.namespace = strings::split(rest, b":").next().unwrap_or_default();
            }
            let (name, has_explicit_namespace) = restored(attr.namespace, attr.name_span);
            attr.name = Cow::Borrowed(name);
            attr.has_explicit_namespace = has_explicit_namespace;
            attr.value = attr.value_span.map(|span| match span.of(text) {
                [b'"' | b'\''] => &b""[..],
                [b'"' | b'\'', inner @ .., _] => inner,
                value => value,
            });
            if options.normalize_attribute_name
                && attr.namespace.is_empty()
                && name.iter().any(u8::is_ascii_uppercase)
            {
                let lower = name.to_ascii_lowercase();
                if data::is_attribute_of_element(element_name, &lower) {
                    attr.name = Cow::Owned(lower);
                }
            }
        }
    }

    /// `postprocess`, for everything in `root`.
    fn postprocess(&mut self, root: Id, options: ParseOptions) -> Result<'a, ()> {
        // What is in a node comes behind it, and no node is looked at before its parent.
        let mut next = self.tree.first_child(root);
        while let Some(id) = next {
            self.postprocess_node(id, options)?;
            // What is in a conditional comment has been through this.
            let first_child = self
                .tree
                .first_child(id)
                .filter(|_| self.tree[id].kind != Kind::IeConditionalComment);
            next = first_child.or_else(|| {
                let mut at = id;
                loop {
                    if let Some(next) = self.tree.next(at) {
                        return Some(next);
                    }
                    at = self.tree.parent(at).filter(|&parent| parent != root)?;
                }
            });
        }
        Ok(())
    }

    /// `parseIeConditionalComment`: the comment becomes what it is.
    fn parse_ie_conditional_comment(&mut self, id: Id, options: ParseOptions) -> Result<'a, ()> {
        let text = self.text;
        let span = self.tree[id].span;
        let value: &'a [u8] = match &self.tree[id].value {
            Cow::Borrowed(value) => value,
            Cow::Owned(_) => return Ok(()),
        };
        // `<!\s*\[endif\]$`: what is before it.
        let before_end = value
            .strip_suffix(b"[endif]")
            .and_then(|rest| text::trim_end(rest).strip_suffix(b"<!"));
        if before_end == Some(b"") {
            self.tree[id].kind = Kind::IeConditionalEndComment;
            return Ok(());
        }
        // `[if`, the condition, `]>`
        let Some(rest) = value.strip_prefix(b"[if") else {
            return Ok(());
        };
        let Some(condition_len) = strings::index_of_char_usize(rest, b']') else {
            return Ok(());
        };
        let Some(after_condition) = rest[condition_len + 1..].strip_prefix(b">") else {
            return Ok(());
        };
        let condition = collapse_white_space(&rest[..condition_len]);
        let opening_len = 3 + condition_len + 2;
        let Some(data_len) = before_end.and_then(|before| before.len().checked_sub(opening_len))
        else {
            if after_condition == b"<!" {
                let node = &mut self.tree[id];
                node.kind = Kind::IeConditionalStartComment;
                node.value = Cow::Owned(condition);
            }
            return Ok(());
        };
        let content_start = span.start + 4 + opening_len as u32;
        let content = Span::new(content_start, content_start + data_len as u32);
        if self.depth >= 16 {
            return Err(ParseError::NestedTooDeeply);
        }
        self.depth += 1;
        let parsed = self.parse(content, options);
        self.depth -= 1;
        let is_complete = match parsed {
            Ok(root) => {
                // Prettier parses it with blanks in the place of what is before it, so the first child is a text.
                let starts_with_text = self.tree.first_child(root).is_some_and(|first| {
                    self.tree[first].kind == Kind::Text
                        && self.tree[first].span.start == content.start
                });
                if !starts_with_text {
                    let empty = self.tree.add(Node::text(
                        Cow::Borrowed(b""),
                        Span::new(content.start, content.start),
                    ));
                    self.tree.append_child(id, empty);
                }
                let mut next = self.tree.first_child(root);
                while let Some(child) = next {
                    next = self.tree.next(child);
                    self.tree.append_child(id, child);
                }
                true
            }
            Err(ParseError::NestedTooDeeply) => return Err(ParseError::NestedTooDeeply),
            Err(ParseError::Syntax(_)) => {
                let only = self
                    .tree
                    .add(Node::text(Cow::Borrowed(content.of(text)), content));
                self.tree.append_child(id, only);
                false
            }
        };
        let node = &mut self.tree[id];
        node.kind = Kind::IeConditionalComment;
        node.flags.set(Flags::IS_COMPLETE, is_complete);
        node.value = Cow::Owned(condition);
        node.set_start_span(Span::new(span.start, content.start));
        node.set_end_span(Some(Span::new(content.end, span.end)));
        Ok(())
    }
}

/// `text.trim().replaceAll(/\s+/g, " ")`
pub(crate) fn collapse_white_space(value: &[u8]) -> Vec<u8> {
    let mut rest = text::trim(value);
    let mut result = Vec::with_capacity(rest.len());
    while let Some(&byte) = rest.first() {
        match text::white_space_len(rest) {
            len @ 1.. => {
                if result.last() != Some(&b' ') {
                    result.push(b' ');
                }
                rest = &rest[len..];
            }
            0 => {
                result.push(byte);
                rest = &rest[1..];
            }
        }
    }
    result
}

/// Fills `tree` with the syntax of `text`, in which there are blanks in the place of the front matter, which is
/// `front_matter_len` long.
pub(crate) fn parse<'a>(
    text: &'a [u8],
    front_matter_len: Option<usize>,
    parser: Parser,
    tree: &mut Tree<'a>,
) -> Result<'a, ()> {
    let all = Span::new(0, text.len() as u32);
    let mut context = Context {
        text,
        tree,
        is_vue: parser == Parser::Vue,
        depth: 0,
    };
    let root = context.parse(all, parse_options(parser))?;
    if let Some(len) = front_matter_len {
        let front_matter = tree.add(Node::new(Kind::FrontMatter, Span::new(0, len as u32)));
        match tree.first_child(root) {
            Some(first) => tree.insert_before(first, front_matter),
            None => tree.append_child(root, front_matter),
        }
    }
    tree.root = root;
    Ok(())
}
