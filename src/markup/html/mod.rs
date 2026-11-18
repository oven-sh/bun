//! <https://html.spec.whatwg.org/multipage/parsing.html>

pub mod entities;
mod quirks;
mod tags;
#[cfg(test)]
mod tests;
mod tokenizer;
mod tree_builder;

pub use tags::{Kind, ShortName, Tag};
pub use tree_builder::Context;

use crate::{Chars, Text, with_units};
use tokenizer::Tokenizer;
use tree_builder::{Builder, State};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Namespace {
    Html,
    Svg,
    MathMl,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttributeNamespace {
    None,
    XLink,
    Xml,
    Xmlns,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Quirks {
    None,
    Limited,
    Full,
}

pub trait Dom: Sized {
    /// The parser passes on only those of [`Parser::nodes`], and those that it was given in the same [`Parser::run`].
    type Node: Copy + Eq;
    type Name: Clone + Eq;
    type Text: Clone;
    /// The attributes of a start tag that keeps coming, ready for use.
    type Stencil: Clone;
    fn chars_of_name(name: &Self::Name) -> Chars<'_>;
    fn chars_of_text(text: &Self::Text) -> Chars<'_>;
    fn attributes_of(stencil: &Self::Stencil) -> Vec<Attribute<Self>>;
}

pub struct Attribute<D: Dom> {
    /// The local name.
    pub name: D::Name,
    pub namespace: AttributeNamespace,
    pub value: D::Text,
}

impl<D: Dom> Clone for Attribute<D> {
    fn clone(&self) -> Self {
        Attribute {
            name: self.name.clone(),
            namespace: self.namespace,
            value: self.value.clone(),
        }
    }
}

pub fn find_attribute<'a, D: Dom>(
    attributes: &'a [Attribute<D>],
    name: &str,
) -> Option<&'a D::Text> {
    attributes
        .iter()
        .find(|it| D::chars_of_name(&it.name).is(name.as_bytes()))
        .map(|it| &it.value)
}

/// Both start at 0.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

pub enum ElementName<'a, D: Dom> {
    Known(Tag),
    Other(&'a D::Name),
}

pub struct NewElement<'a, D: Dom> {
    pub name: ElementName<'a, D>,
    pub namespace: Namespace,
    /// The sink may take them.
    pub attributes: &'a mut Vec<Attribute<D>>,
    /// In place of `attributes`.
    pub stencil: Option<&'a D::Stencil>,
    pub intended_parent: D::Node,
    /// Of what follows the start tag of a script.
    pub position: Position,
    pub had_duplicate_attributes: bool,
}

/// What is between the `<` and the `>` of a start tag.
#[derive(Clone, Copy)]
pub struct TagSource<'a> {
    pub chars: Chars<'a>,
    pub hash: u64,
}

#[derive(Clone, Copy)]
pub struct Place<N> {
    pub parent: N,
    pub before: Option<N>,
}

/// Where the content of a `<template for>` goes.
#[derive(Clone, Copy)]
pub struct Patch<N> {
    pub target: N,
    pub start: N,
    pub end: Option<N>,
}

type NodeOf<S> = <<S as Sink>::Dom as Dom>::Node;
type NameOf<S> = <<S as Sink>::Dom as Dom>::Name;
type TextOf<S> = <<S as Sink>::Dom as Dom>::Text;
type StencilOf<S> = <<S as Sink>::Dom as Dom>::Stencil;

pub trait Sink {
    type Dom: Dom;

    /// `short` is the same name, if that was at hand.
    fn name(&mut self, chars: Chars<'_>, short: Option<ShortName>) -> NameOf<Self>;
    fn value(&mut self, name: &NameOf<Self>, chars: Chars<'_>) -> TextOf<Self>;
    /// What `remember` has returned for the same source.
    fn recall(&mut self, source: TagSource<'_>) -> Option<StencilOf<Self>>;
    /// Takes the attributes if it returns something.
    fn remember(
        &mut self,
        source: TagSource<'_>,
        tag: Tag,
        attributes: &mut Vec<Attribute<Self::Dom>>,
    ) -> Option<StencilOf<Self>>;

    fn document(&self) -> NodeOf<Self>;
    fn is_in_quirks_mode(&self) -> bool;
    fn set_quirks(&mut self, quirks: Quirks);
    fn parent(&self, node: NodeOf<Self>) -> Option<NodeOf<Self>>;
    /// `None` if it is not a template.
    fn template_contents(&mut self, node: NodeOf<Self>) -> Option<NodeOf<Self>>;

    /// To the intended parent, if there is nothing more to it. What it returns has to be pinned before it is passed to anything but
    /// `parent`, `template_contents` and the likes of this.
    fn append_element_quietly(&mut self, _: NewElement<'_, Self::Dom>) -> Option<NodeOf<Self>> {
        None
    }
    fn append_text_quietly(&mut self, _: Chars<'_>, _parent: NodeOf<Self>) -> bool {
        false
    }
    fn append_comment_quietly(&mut self, _: Chars<'_>, _parent: NodeOf<Self>) -> bool {
        false
    }
    fn is_pinned(&self, _: NodeOf<Self>) -> bool {
        true
    }
    /// What stands for the node from now on.
    fn pin(&mut self, node: NodeOf<Self>) -> NodeOf<Self> {
        node
    }
    /// What was appended quietly may be looked at from now on.
    fn publish(&mut self) {}

    fn create_element(&mut self, element: NewElement<'_, Self::Dom>) -> NodeOf<Self>;
    fn insert_element(&mut self, node: NodeOf<Self>, place: Place<NodeOf<Self>>);
    /// If so, it is left to the caller of [`Parser::run`] where possible.
    fn runs_script_when_inserted(&self, node: NodeOf<Self>) -> bool;
    /// Extends the text node before the place, if there is one.
    fn insert_text(&mut self, text: Chars<'_>, place: Place<NodeOf<Self>>);
    fn insert_comment(&mut self, data: Chars<'_>, place: Place<NodeOf<Self>>);
    fn insert_instruction(
        &mut self,
        target: Chars<'_>,
        data: Chars<'_>,
        place: Place<NodeOf<Self>>,
    );
    fn insert_doctype(&mut self, name: Chars<'_>, public_id: Chars<'_>, system_id: Chars<'_>);
    /// Removes the node, and inserts it unless script has made that impossible.
    fn reparent(&mut self, node: NodeOf<Self>, place: Place<NodeOf<Self>>);
    fn reparent_children(&mut self, from: NodeOf<Self>, to: NodeOf<Self>);
    fn remove(&mut self, node: NodeOf<Self>);
    fn add_missing_attributes(
        &mut self,
        node: NodeOf<Self>,
        attributes: &mut Vec<Attribute<Self::Dom>>,
    );

    /// For a custom element too, which may not be form-associated. `form` is not open any more.
    fn associate_with_form(
        &mut self,
        node: NodeOf<Self>,
        form: NodeOf<Self>,
        intended_parent: NodeOf<Self>,
    );
    /// Returns a template whose contents are the shadow root.
    fn attach_shadow(
        &mut self,
        host: NodeOf<Self>,
        template: NewElement<'_, Self::Dom>,
    ) -> Option<NodeOf<Self>>;
    /// Removes what is between the markers called `name` below `scope`.
    fn start_patch(&mut self, scope: NodeOf<Self>, name: Chars<'_>) -> Option<Patch<NodeOf<Self>>>;
    /// An element of [`Kind::REPORTS_END`], or one of SVG with such a name, was popped off the stack of open elements.
    fn finished(&mut self, node: NodeOf<Self>);
    fn mark_script_as_started(&mut self, script: NodeOf<Self>);
    /// Asked after each token.
    fn wants_to_pause(&mut self) -> bool;
}

#[derive(Clone, Copy)]
pub struct Options {
    pub scripting: bool,
    pub allows_declarative_shadow_roots: bool,
    pub allows_patches: bool,
    /// The document is an `iframe srcdoc` document, or "parser cannot change the mode".
    pub keeps_mode: bool,
}

pub enum Stop<N> {
    NeedsInput,
    /// Its end tag has been seen.
    Script(N),
    /// For [`Sink::insert_element`].
    Insert(N, Place<N>),
    Paused,
    Finished,
}

struct Input<D: Dom> {
    text: Text,
    /// In place of `text`.
    shared: Option<D::Text>,
    at: usize,
    ends_with_return: bool,
}

impl<D: Dom> Default for Input<D> {
    fn default() -> Self {
        Input {
            text: Text::default(),
            shared: None,
            at: 0,
            ends_with_return: false,
        }
    }
}

impl<D: Dom> Input<D> {
    #[inline]
    fn chars(&self) -> Chars<'_> {
        self.shared
            .as_ref()
            .map_or_else(|| self.text.chars(), D::chars_of_text)
    }
}

fn push_normalized(text: &mut Text, mut more: Chars<'_>) {
    while let Some(at) = more.find(0, b'\r') {
        text.push(more.slice(0..at));
        text.push_byte(b'\n');
        more = more.skip(at + 1 + usize::from(more.get(at + 1) == Some(b'\n'.into())));
    }
    text.push(more);
}

/// The parser of a document.
pub struct Parser<D: Dom> {
    state: State<D>,
    tokenizer: Tokenizer,
    input: Input<D>,
    /// What follows the insertion point of each script that is running.
    suspended: Vec<Input<D>>,
    has_ended: bool,
}

impl<D: Dom> Parser<D> {
    pub fn new(options: Options) -> Self {
        Parser {
            state: State::new(options),
            tokenizer: Tokenizer::default(),
            input: Input::default(),
            suspended: Vec::new(),
            has_ended: false,
        }
    }

    /// At the insertion point, or else at the end.
    pub fn write(&mut self, mut more: Chars<'_>) {
        if more.is_empty() {
            return;
        }
        let ends_with_return = more.ends_with(b"\r");
        if core::mem::replace(&mut self.input.ends_with_return, ends_with_return)
            && more.starts_with(b"\n")
        {
            more = more.skip(1);
        }
        if self.input.at > self.input.text.len() / 2 || self.input.shared.is_some() {
            self.drop_what_was_read();
        }
        push_normalized(&mut self.input.text, more);
    }

    /// The same, without a copy if it is worth it.
    pub fn write_shared(&mut self, more: &D::Text) {
        let chars = D::chars_of_text(more);
        if chars.len() < 1 << 12
            || self.input.at < self.input.chars().len()
            || self.input.ends_with_return
            || !matches!(chars, Chars::Latin1(_))
            || chars.contains(b'\r')
        {
            return self.write(chars);
        }
        self.drop_what_was_read();
        self.input.shared = Some(more.clone());
    }

    fn drop_what_was_read(&mut self) {
        self.count_lines();
        match self.input.shared.take() {
            Some(shared) => self
                .input
                .text
                .push(D::chars_of_text(&shared).skip(self.input.at)),
            None => self.input.text.drop_front(self.input.at),
        }
        if self.suspended.is_empty() {
            self.tokenizer.lines.dropped(self.input.at);
        }
        self.input.at = 0;
    }

    pub fn end(&mut self) {
        self.has_ended = true;
    }

    fn count_lines(&mut self) {
        if self.suspended.is_empty() {
            with_units!(self.input.chars(), units => self.tokenizer.lines.advance(units, self.input.at));
        }
    }

    /// What is written until [`Parser::end_script`] is read before the rest of the input.
    pub fn begin_script(&mut self) {
        self.count_lines();
        self.suspended.push(core::mem::take(&mut self.input));
    }

    pub fn end_script(&mut self) {
        let Some(rest) = self.suspended.pop() else {
            return;
        };
        let written = core::mem::replace(&mut self.input, rest);
        let unread = written.chars().skip(written.at);
        if !unread.is_empty() {
            if self.input.shared.is_some() {
                self.drop_what_was_read();
            }
            let old = self.input.at;
            self.input.at = self.input.text.unread(old, unread);
            if self.suspended.is_empty() {
                self.tokenizer
                    .lines
                    .moved(old, self.input.at + unread.len());
            }
        }
    }

    pub fn run<S: Sink<Dom = D>>(&mut self, sink: &mut S) -> Stop<D::Node> {
        let input = match (self.suspended.is_empty(), self.has_ended) {
            (false, _) => tokenizer::Input::Written,
            (true, false) => tokenizer::Input::PartOfDocument,
            (true, true) => tokenizer::Input::RestOfDocument,
        };
        let mut builder = Builder {
            state: &mut self.state,
            sink,
        };
        let mut at = self.input.at;
        let stop = with_units!(self.input.chars(), units => self.tokenizer.run(units, &mut at, input, &mut builder));
        self.input.at = at;
        builder.pin_open();
        stop
    }

    pub fn unread(&self) -> Text {
        let mut all = Text::default();
        for input in core::iter::once(&self.input).chain(self.suspended.iter().rev()) {
            all.push(input.chars().skip(input.at));
        }
        all
    }

    pub fn current_node(&self) -> Option<D::Node> {
        self.state.current_node()
    }

    pub fn is_open(&self, node: D::Node) -> bool {
        self.state.is_open(node)
    }

    pub fn is_in_template(&self) -> bool {
        self.state.is_in_template()
    }

    /// All that it may come back to.
    pub fn nodes(&self) -> impl Iterator<Item = D::Node> + '_ {
        self.state.nodes()
    }
}

/// What it makes is appended to `root`, which stands for the `html` element of
/// <https://html.spec.whatwg.org/multipage/parsing.html#html-fragment-parsing-algorithm>.
pub fn parse_fragment<S: Sink>(
    source: Chars<'_>,
    context: &Context<S::Dom>,
    root: NodeOf<S>,
    options: Options,
    sink: &mut S,
) {
    let mut normalized = Text::default();
    let source = if source.contains(b'\r') {
        push_normalized(&mut normalized, source);
        normalized.chars()
    } else {
        source
    };
    let mut state = State::for_fragment(options, context, root);
    let (mut tokenizer, mut at) = (Tokenizer::default(), 0);
    loop {
        let mut builder = Builder {
            state: &mut state,
            sink,
        };
        match with_units!(source, units => tokenizer.run(units, &mut at, tokenizer::Input::Fragment, &mut builder))
        {
            Stop::Finished | Stop::NeedsInput => return,
            Stop::Insert(node, place) => sink.insert_element(node, place),
            Stop::Script(_) | Stop::Paused => {}
        }
    }
}
