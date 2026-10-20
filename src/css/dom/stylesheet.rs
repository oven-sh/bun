//! Style sheets: from text to a flat list of rules.
//!
//! Bun's own `StyleSheet::parse` is not used: it merges and reorders declarations for the bundler, and the CSSOM has to
//! show every rule and every declaration where the author put it. The tokenizer, the rule and block machinery, selectors,
//! media queries and `@supports` conditions are Bun's.

use bun_alloc::Arena;

use super::declarations::{DeclarationSink, property_name};
use super::{
    Declaration, FLAG_REFUSE_INVALID_RULES, PseudoElementKind, Rule, RuleKind, RuleSelector,
    StringRange, StyleSheet,
};
use crate::VendorPrefix;
use crate::css_parser::{
    AtRuleParser, BasicParseErrorKind, CssResult, DeclarationParser, Maybe, Parser, ParserInput,
    ParserOptions, ParserState, QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser,
    StyleSheetParser, Token, Tokenizer,
};
use crate::media_query::{MediaList, MediaType, Qualifier};
use crate::rules::supports::SupportsCondition;
use crate::selector::serialize::serialize_selector_list;
use crate::selectors::dom::supports_selector;
use crate::selectors::parser::{
    Combinator, Component, NestingRequirement, ParseErrorRecovery, PseudoElement, Selector,
    SelectorFlags, SelectorList, SelectorParser,
};

pub(crate) fn parse(source: &[u8], arena: &Arena, flags: u32) -> Option<StyleSheet> {
    let mut rule_parser = RuleParser {
        source,
        sink: DeclarationSink::new(arena, flags),
        rules: Vec::new(),
        selectors: Vec::new(),
        declarations: Vec::new(),
        parents: Vec::new(),
        depth: 0,
    };
    {
        let mut input = ParserInput::new(source, arena);
        let mut parser = Parser::new(&mut input, None, rule_parser.sink.parser_opts(), None);
        let mut sheet_parser = StyleSheetParser::new(&mut parser, &mut rule_parser);
        while let Some(result) = sheet_parser.next() {
            // An invalid rule is left out.
            if result.is_err() && flags & FLAG_REFUSE_INVALID_RULES != 0 {
                return None;
            }
        }
    }
    let RuleParser {
        sink,
        rules,
        selectors,
        declarations,
        ..
    } = rule_parser;
    let (_, strings) = sink.finish();
    Some(StyleSheet::new(rules, selectors, declarations, strings))
}

struct RuleParser<'a> {
    source: &'a [u8],
    /// Its `declarations` are those of the block that is being parsed.
    sink: DeclarationSink<'a>,
    rules: Vec<Rule>,
    selectors: Vec<RuleSelector>,
    /// Those of the blocks that are finished. A rule's declarations follow each other here, also when rules are nested in it.
    declarations: Vec<Declaration>,
    /// The selector lists of the style rules the parser is in, innermost last, each with its own `&` already replaced.
    parents: Vec<Vec<u8>>,
    /// How many blocks of at-rules the parser is in.
    depth: u32,
}

/// Where the declarations of a block are in `RuleParser::declarations`.
struct DeclarationRange {
    first_declaration: u32,
    declaration_count: u32,
}

/// What stands between the name of an at-rule and its block or its semicolon.
struct AtRulePrelude {
    kind: RuleKind,
    condition_is_true: bool,
    text: StringRange,
    /// Where it ends in the source.
    end: usize,
}

impl RuleKind {
    fn has_rules_inside(self) -> bool {
        matches!(
            self,
            RuleKind::Media
                | RuleKind::Supports
                | RuleKind::LayerBlock
                | RuleKind::Container
                | RuleKind::Scope
                | RuleKind::StartingStyle
        )
    }
}

fn at_rule_kind(name: &[u8]) -> Option<RuleKind> {
    const KINDS: [(&[u8], RuleKind); 19] = [
        (b"media", RuleKind::Media),
        (b"supports", RuleKind::Supports),
        (b"layer", RuleKind::LayerBlock),
        (b"container", RuleKind::Container),
        (b"scope", RuleKind::Scope),
        (b"starting-style", RuleKind::StartingStyle),
        (b"font-face", RuleKind::FontFace),
        (b"keyframes", RuleKind::Keyframes),
        (b"-webkit-keyframes", RuleKind::Keyframes),
        (b"import", RuleKind::Import),
        (b"namespace", RuleKind::Namespace),
        (b"property", RuleKind::Property),
        (b"page", RuleKind::Page),
        (b"counter-style", RuleKind::CounterStyle),
        (b"font-palette-values", RuleKind::FontPaletteValues),
        (b"font-feature-values", RuleKind::FontFeatureValues),
        (b"view-transition", RuleKind::ViewTransition),
        (b"position-try", RuleKind::PositionTry),
        (b"-webkit-font-face", RuleKind::FontFace),
    ];
    KINDS
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
        .map(|(_, kind)| *kind)
}

fn skip_to_end(input: &mut Parser) {
    while input.next().is_ok() {}
}

/// There is a screen and nothing is known about it: a query that asks for a feature is false.
fn media_list_matches(list: &MediaList) -> bool {
    list.media_queries.is_empty()
        || list.media_queries.iter().any(|query| {
            if query.condition.is_some() {
                return false;
            }
            let type_matches = matches!(query.media_type, MediaType::All | MediaType::Screen);
            match query.qualifier {
                Some(Qualifier::Not) => !type_matches,
                _ => type_matches,
            }
        })
}

fn pseudo_element_kind(pseudo_element: &PseudoElement) -> PseudoElementKind {
    let unprefixed = |prefix: &VendorPrefix, kind: PseudoElementKind| {
        if prefix.is_empty() || *prefix == VendorPrefix::NONE {
            kind
        } else {
            PseudoElementKind::Other
        }
    };
    match pseudo_element {
        PseudoElement::Before => PseudoElementKind::Before,
        PseudoElement::After => PseudoElementKind::After,
        PseudoElement::Marker => PseudoElementKind::Marker,
        PseudoElement::FirstLine => PseudoElementKind::FirstLine,
        PseudoElement::FirstLetter => PseudoElementKind::FirstLetter,
        PseudoElement::Placeholder(prefix) => unprefixed(prefix, PseudoElementKind::Placeholder),
        PseudoElement::Selection(prefix) => unprefixed(prefix, PseudoElementKind::Selection),
        PseudoElement::Backdrop(prefix) => unprefixed(prefix, PseudoElementKind::Backdrop),
        PseudoElement::FileSelectorButton(prefix) => {
            unprefixed(prefix, PseudoElementKind::FileSelectorButton)
        }
        _ => PseudoElementKind::Other,
    }
}

fn pseudo_element_text(kind: PseudoElementKind) -> &'static [u8] {
    match kind {
        PseudoElementKind::None
        | PseudoElementKind::Other
        | PseudoElementKind::Slotted
        | PseudoElementKind::SlotOfSlotted => b"",
        PseudoElementKind::Before => b"::before",
        PseudoElementKind::After => b"::after",
        PseudoElementKind::Marker => b"::marker",
        PseudoElementKind::FirstLine => b"::first-line",
        PseudoElementKind::FirstLetter => b"::first-letter",
        PseudoElementKind::Placeholder => b"::placeholder",
        PseudoElementKind::Selection => b"::selection",
        PseudoElementKind::Backdrop => b"::backdrop",
        PseudoElementKind::FileSelectorButton => b"::file-selector-button",
    }
}

/// `a > ::before` is `a > *::before`. Without the pseudo-element the `*` has to be there.
fn restore_universal_selector(selector: &mut Selector) {
    if matches!(selector.components.first(), Some(Component::Combinator(_))) {
        selector
            .components
            .insert(0, Component::ExplicitUniversalType);
    }
}

/// Takes the pseudo-element off the end of the selector, unless it is `Other`. Components are stored right to left, so
/// `a::before` is `[::before, the pseudo-element combinator, a]`.
fn take_pseudo_element(selector: &mut Selector) -> PseudoElementKind {
    let flags = selector.specificity_and_flags.flags;
    if !flags.intersects(
        SelectorFlags::HAS_PSEUDO | SelectorFlags::HAS_SLOTTED | SelectorFlags::HAS_PART,
    ) {
        return PseudoElementKind::None;
    }
    let kind = match (selector.components.first(), selector.components.get(1)) {
        (
            Some(Component::PseudoElement(pseudo_element)),
            Some(Component::Combinator(Combinator::PseudoElement)),
        ) => pseudo_element_kind(pseudo_element),
        _ => PseudoElementKind::Other,
    };
    if kind != PseudoElementKind::Other {
        drop(selector.components.drain(..2));
        restore_universal_selector(selector);
    }
    kind
}

/// Takes `::slotted(y)` off the end of the selector and returns `y`.
fn take_slotted(selector: &mut Selector) -> Option<Selector> {
    if !matches!(
        (selector.components.first(), selector.components.get(1)),
        (
            Some(Component::Slotted(_)),
            Some(Component::Combinator(Combinator::SlotAssignment))
        )
    ) {
        return None;
    }
    let slotted = match selector.components.drain(..2).next() {
        Some(Component::Slotted(slotted)) => slotted,
        _ => return None,
    };
    restore_universal_selector(selector);
    Some(slotted)
}

/// `&` stands for what the parent rule matches: https://drafts.csswg.org/css-nesting/#nest-selector
fn resolve_nesting_selector(selector: &[u8], parent: &[u8], arena: &Arena) -> Vec<u8> {
    let mut result = Vec::with_capacity(selector.len() + parent.len() + 5);
    let mut tokenizer = Tokenizer::init_with_arena(selector, arena);
    let mut copied = 0;
    loop {
        let start = tokenizer.get_position();
        let Ok(token) = tokenizer.next() else {
            break;
        };
        if matches!(token, Token::Delim(delim) if delim == u32::from(b'&')) {
            result.extend_from_slice(&selector[copied..start]);
            result.extend_from_slice(b":is(");
            result.extend_from_slice(parent);
            result.push(b')');
            copied = tokenizer.get_position();
        }
    }
    result.extend_from_slice(&selector[copied..]);
    result
}

impl RuleParser<'_> {
    fn count(length: usize) -> u32 {
        u32::try_from(length).expect("int cast")
    }

    /// From `start` to `end` in the source, and then `closer`.
    fn push_source(&mut self, start: usize, end: usize, closer: u8) -> StringRange {
        let offset = self.sink.strings.len();
        self.sink
            .strings
            .extend_from_slice(self.source[start..end].trim_ascii_end());
        if closer == b'}' {
            self.sink.strings.push(b' ');
        }
        self.sink.strings.push(closer);
        StringRange {
            offset: Self::count(offset),
            length: Self::count(self.sink.strings.len() - offset),
        }
    }

    fn supports(&mut self, condition: &SupportsCondition) -> bool {
        match condition {
            SupportsCondition::Not(condition) => !self.supports(condition),
            SupportsCondition::And(conditions) => conditions.iter().all(|c| self.supports(c)),
            SupportsCondition::Or(conditions) => conditions.iter().any(|c| self.supports(c)),
            SupportsCondition::Declaration(declaration) => {
                match property_name(&declaration.property_id, self.sink.arena()) {
                    Some(name) => self.sink.supports_declaration(name, declaration.value),
                    None => false,
                }
            }
            SupportsCondition::Selector(selector) => supports_selector(selector),
            // `SupportsCondition::parse` never tries a declaration: `(name: value)` arrives here.
            SupportsCondition::Unknown(text) => self.supports_declaration_in_parentheses(text),
        }
    }

    fn supports_declaration_in_parentheses(&mut self, text: &[u8]) -> bool {
        let Some(declaration) = text
            .trim_ascii()
            .strip_prefix(b"(")
            .and_then(|text| text.strip_suffix(b")"))
        else {
            return false;
        };
        let Some(colon) = bun_core::strings::index_of_char_usize(declaration, b':') else {
            return false;
        };
        self.sink
            .supports_declaration(declaration[..colon].trim_ascii(), &declaration[colon + 1..])
    }

    /// The rules and the declarations of a block. Returns where the declarations are.
    fn parse_block_contents(&mut self, input: &mut Parser) -> DeclarationRange {
        let enclosing = core::mem::take(&mut self.sink.declarations);
        {
            let mut body = RuleBodyParser::new(input, self);
            while let Some(result) = body.next() {
                let _ = result;
            }
        }
        let own = core::mem::replace(&mut self.sink.declarations, enclosing);
        let first = self.declarations.len();
        self.declarations.extend(own);
        DeclarationRange {
            first_declaration: Self::count(first),
            declaration_count: Self::count(self.declarations.len() - first),
        }
    }

    /// `*` for a selector that has nothing left. None if it cannot be printed.
    fn print_selector(&mut self, selector: &Selector) -> Option<StringRange> {
        if selector.components.is_empty() {
            return Some(self.sink.push_str(b"*"));
        }
        self.sink.print(&[], &[], &|dest| {
            serialize_selector_list(core::slice::from_ref(selector), dest, None, false)
        })
    }

    /// Returns the first selector, their number, the list as `selectorText` shows it, and the list as `&` in a nested rule sees it.
    /// None if a selector cannot be printed.
    fn push_selectors(
        &mut self,
        list: &mut SelectorList,
    ) -> Option<(u32, u32, StringRange, Vec<u8>)> {
        let first_selector = self.selectors.len();
        for selector in &mut list.v {
            if let Some(slotted) = take_slotted(selector) {
                let text = self.print_selector(&slotted)?;
                self.selectors.push(RuleSelector {
                    text,
                    pseudo_element: PseudoElementKind::Slotted,
                });
                let text = self.print_selector(selector)?;
                self.selectors.push(RuleSelector {
                    text,
                    pseudo_element: PseudoElementKind::SlotOfSlotted,
                });
                continue;
            }
            let pseudo_element = take_pseudo_element(selector);
            let text = self.print_selector(selector)?;
            self.selectors.push(RuleSelector {
                text,
                pseudo_element,
            });
        }

        // The list as `selectorText` shows it.
        let offset = self.sink.strings.len();
        let mut slotted = None;
        for selector in &self.selectors[first_selector..] {
            let text = selector.text.offset as usize
                ..(selector.text.offset + selector.text.length) as usize;
            if selector.pseudo_element == PseudoElementKind::Slotted {
                slotted = Some(text);
                continue;
            }
            if self.sink.strings.len() > offset {
                self.sink.strings.extend_from_slice(b", ");
            }
            let pseudo_element = pseudo_element_text(selector.pseudo_element);
            // `::before` was `*::before` for the sake of matching.
            let has_pseudo_element = !pseudo_element.is_empty() || slotted.is_some();
            let written = &self.sink.strings[text.clone()];
            let mut shown = text;
            if has_pseudo_element && (written == b"*" || written.ends_with(b" *")) {
                shown.end -= 1;
            }
            self.sink.strings.extend_from_within(shown);
            self.sink.strings.extend_from_slice(pseudo_element);
            if let Some(slotted) = slotted.take() {
                self.sink.strings.extend_from_slice(b"::slotted(");
                self.sink.strings.extend_from_within(slotted);
                self.sink.strings.push(b')');
            }
        }
        let text = StringRange {
            offset: Self::count(offset),
            length: Self::count(self.sink.strings.len() - offset),
        };

        let mut resolved_list = Vec::new();
        for index in first_selector..self.selectors.len() {
            let written = self.selectors[index].text;
            let written =
                self.sink.strings[written.offset as usize..][..written.length as usize].to_vec();
            let resolved = match self.parents.last() {
                Some(parent) => {
                    let resolved = resolve_nesting_selector(&written, parent, self.sink.arena());
                    self.selectors[index].text = self.sink.push_str(&resolved);
                    resolved
                }
                None => written,
            };
            // `&` cannot stand for a pseudo-element.
            if self.selectors[index].pseudo_element == PseudoElementKind::None {
                if !resolved_list.is_empty() {
                    resolved_list.extend_from_slice(b", ");
                }
                resolved_list.extend_from_slice(&resolved);
            }
        }
        if resolved_list.is_empty() {
            resolved_list.extend_from_slice(b":not(*)");
        }

        Some((
            Self::count(first_selector),
            Self::count(self.selectors.len() - first_selector),
            text,
            resolved_list,
        ))
    }
}

impl AtRuleParser for RuleParser<'_> {
    type Prelude = AtRulePrelude;
    type AtRule = ();

    fn parse_prelude(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<AtRulePrelude> {
        let Some(kind) = at_rule_kind(name) else {
            return Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid));
        };
        if !this.parents.is_empty() && !kind.has_rules_inside() {
            return Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid));
        }

        input.skip_whitespace();
        let start = input.position();
        let mut condition_is_true = true;
        let mut printed = None;
        match kind {
            RuleKind::Media => {
                let options = ParserOptions::default(None);
                match input.try_parse(|input| MediaList::parse(input, &options)) {
                    Ok(list) => {
                        condition_is_true = media_list_matches(&list);
                        // Bun's printer turns `(min-width: 1px)` into `(width >= 1px)`. A feature stays as it was written.
                        let has_features = list.media_queries.iter().any(|q| q.condition.is_some());
                        if list.media_queries.is_empty() {
                            printed = Some(StringRange::default());
                        } else if !has_features {
                            printed = this.sink.print(&[], &[], &|dest| list.to_css(dest));
                        }
                    }
                    // A query that cannot be parsed is `not all`.
                    Err(_) => {
                        condition_is_true = false;
                        printed = Some(this.sink.push_str(b"not all"));
                    }
                }
            }
            RuleKind::Supports => {
                let condition = SupportsCondition::parse(input)?;
                condition_is_true = this.supports(&condition);
            }
            // These ask for layout, for a scoping root, or for a transition that is about to start.
            RuleKind::Container | RuleKind::Scope | RuleKind::StartingStyle => {
                condition_is_true = false;
            }
            _ => {}
        }
        skip_to_end(input);
        let end = input.position();
        let text = match printed {
            Some(text) => text,
            None => {
                let source = this.source;
                this.sink.push_str(source[start..end].trim_ascii())
            }
        };
        Ok(AtRulePrelude {
            kind,
            condition_is_true,
            text,
            end,
        })
    }

    fn rule_without_block(
        this: &mut Self,
        prelude: AtRulePrelude,
        start: &ParserState,
    ) -> Maybe<(), ()> {
        if !this.parents.is_empty() {
            return Err(());
        }
        let kind = match prelude.kind {
            RuleKind::Import | RuleKind::Namespace => prelude.kind,
            RuleKind::LayerBlock => RuleKind::LayerStatement,
            _ => return Err(()),
        };
        // `@import` comes before everything but `@layer a, b;`, and `@namespace` before everything but these two.
        let may_precede = |rule: &Rule| match kind {
            RuleKind::Import => matches!(rule.kind, RuleKind::Import | RuleKind::LayerStatement),
            RuleKind::Namespace => matches!(
                rule.kind,
                RuleKind::Import | RuleKind::LayerStatement | RuleKind::Namespace
            ),
            _ => true,
        };
        if kind != RuleKind::LayerStatement
            && (this.depth > 0 || !this.rules.iter().all(may_precede))
        {
            return Err(());
        }
        let text = this.push_source(start.position, prelude.end, b';');
        this.rules.push(Rule {
            kind,
            condition_is_true: true,
            descendant_count: 0,
            first_selector: 0,
            selector_count: 0,
            first_declaration: 0,
            declaration_count: 0,
            prelude: prelude.text,
            text,
        });
        Ok(())
    }

    fn parse_block(
        this: &mut Self,
        prelude: AtRulePrelude,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<()> {
        if matches!(prelude.kind, RuleKind::Import | RuleKind::Namespace) {
            return Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid));
        }

        let index = this.rules.len();
        this.rules.push(Rule {
            kind: prelude.kind,
            condition_is_true: prelude.condition_is_true,
            descendant_count: 0,
            first_selector: 0,
            selector_count: 0,
            first_declaration: 0,
            declaration_count: 0,
            prelude: prelude.text,
            text: StringRange::default(),
        });
        if prelude.kind.has_rules_inside() {
            this.depth += 1;
            let DeclarationRange {
                first_declaration,
                declaration_count,
            } = this.parse_block_contents(input);
            this.depth -= 1;
            // Declarations that stand in an at-rule nested in a style rule are for what that rule matches: `& { ... }`.
            if declaration_count > 0 {
                let parent = this
                    .parents
                    .last()
                    .map_or(&b":not(*)"[..], |parent| &parent[..]);
                let resolved = resolve_nesting_selector(b"&", parent, this.sink.arena());
                let first_selector = Self::count(this.selectors.len());
                let text = this.sink.push_str(&resolved);
                this.selectors.push(RuleSelector {
                    text,
                    pseudo_element: PseudoElementKind::None,
                });
                let prelude = this.sink.push_str(b"&");
                this.rules.insert(
                    index + 1,
                    Rule {
                        kind: RuleKind::Style,
                        condition_is_true: true,
                        descendant_count: 0,
                        first_selector,
                        selector_count: 1,
                        first_declaration,
                        declaration_count,
                        prelude,
                        text: StringRange::default(),
                    },
                );
            }
            let descendant_count = Self::count(this.rules.len() - index - 1);
            this.rules[index].descendant_count = descendant_count;
        } else {
            skip_to_end(input);
            let text = this.push_source(start.position, input.position(), b'}');
            this.rules[index].text = text;
        }
        Ok(())
    }
}

impl QualifiedRuleParser for RuleParser<'_> {
    type Prelude = SelectorList;
    type QualifiedRule = ();

    fn parse_prelude(this: &mut Self, input: &mut Parser) -> CssResult<SelectorList> {
        let options = ParserOptions::default(None);
        let mut selector_parser = SelectorParser {
            is_nesting_allowed: true,
            options: &options,
        };
        if this.parents.is_empty() {
            SelectorList::parse(
                &mut selector_parser,
                input,
                ParseErrorRecovery::DiscardList,
                NestingRequirement::None,
            )
        } else {
            // `.b` is `& .b`, `> .b` is `& > .b`.
            SelectorList::parse_relative(
                &mut selector_parser,
                input,
                ParseErrorRecovery::DiscardList,
                NestingRequirement::Implicit,
            )
        }
    }

    fn parse_block(
        this: &mut Self,
        mut selectors: SelectorList,
        _: &ParserState,
        input: &mut Parser,
    ) -> CssResult<()> {
        let Some((first_selector, selector_count, prelude, resolved_list)) =
            this.push_selectors(&mut selectors)
        else {
            return Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid));
        };
        let index = this.rules.len();
        this.rules.push(Rule {
            kind: RuleKind::Style,
            condition_is_true: true,
            descendant_count: 0,
            first_selector,
            selector_count,
            first_declaration: 0,
            declaration_count: 0,
            prelude,
            text: StringRange::default(),
        });
        this.parents.push(resolved_list);
        let DeclarationRange {
            first_declaration,
            declaration_count,
        } = this.parse_block_contents(input);
        this.parents.pop();
        let descendant_count = Self::count(this.rules.len() - index - 1);
        let rule = &mut this.rules[index];
        rule.first_declaration = first_declaration;
        rule.declaration_count = declaration_count;
        rule.descendant_count = descendant_count;
        Ok(())
    }
}

impl DeclarationParser for RuleParser<'_> {
    type Declaration = ();

    fn parse_value(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<()> {
        this.sink.parse_declaration(name, input)
    }
}

impl RuleBodyItemParser for RuleParser<'_> {
    fn parse_qualified(_: &Self) -> bool {
        true
    }

    fn parse_declarations(this: &Self) -> bool {
        !this.parents.is_empty()
    }
}
