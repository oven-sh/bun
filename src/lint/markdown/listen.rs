//! How a rule for Markdown listens.
//!
//! A rule of `@eslint/markdown` listens with selectors of esquery, and so does its port: [`Listens::LISTENERS`] has them as
//! upstream writes them, and [`Listens::on`] is called with the number of the one that matches, in the order of ESLint's walk.
//!
//! ```ignore
//! impl Rule for NoEmptyLinks {
//!     const META: Meta = meta("no-empty-links").recommended();
//!     listens!();
//!
//!     fn new(_: &Options) -> Self {
//!         NoEmptyLinks
//!     }
//! }
//!
//! impl Listens for NoEmptyLinks {
//!     const LISTENERS: &'static [Listener] = &[Listener::new("link", Kinds::of(&[Kind::Link]))];
//!     type Seen<'d> = ();
//!
//!     fn on<'d>(&self, _: usize, node: Node<'d>, (): &mut (), cx: &mut Context<'d>) -> Result<(), OutOfRange> {
//!         if matches!(node.url(), b"" | b"#") {
//!             cx.report_node(node, EMPTY_LINK, &[]);
//!         }
//!         Ok(())
//!     }
//! }
//! ```

use crate::document::{Document, Loc, Node, OutOfRange};
use bun_format::markdown::ast::Kind;
use bun_lint::context::Cx;
use bun_lint::rule::{Message, Rule};
use bun_lint::span::{Position, Span};

/// A set of kinds of nodes.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct Kinds(u64);

impl Kinds {
    pub(crate) const ALL: Kinds = Kinds(u64::MAX);
    /// `heading, paragraph, tableCell`
    pub(crate) const WITH_TEXT: Kinds =
        Kinds::of(&[Kind::Heading, Kind::Paragraph, Kind::TableCell]);
    /// What is in no heading, paragraph or cell.
    const BLOCKS: Kinds = Kinds::of(&[
        Kind::Root,
        Kind::FrontMatter,
        Kind::Paragraph,
        Kind::Heading,
        Kind::ThematicBreak,
        Kind::Blockquote,
        Kind::List,
        Kind::ListItem,
        Kind::Code,
        Kind::Definition,
        Kind::FootnoteDefinition,
        Kind::Table,
        Kind::TableRow,
        Kind::TableCell,
        Kind::Math,
    ]);

    pub(crate) const fn of(kinds: &[Kind]) -> Kinds {
        let (mut bits, mut at) = (0, 0);
        while at < kinds.len() {
            bits |= 1 << kinds[at] as u8;
            at += 1;
        }
        Kinds(bits)
    }

    #[inline]
    pub(crate) const fn has(self, kind: Kind) -> bool {
        self.0 & (1 << kind as u8) != 0
    }
}

/// What is before the last part of a selector.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Within {
    Anything,
    /// `heading ..`
    Heading,
    /// `:matches(heading, paragraph, tableCell) ..`
    NodeWithText,
    /// `:matches(heading, paragraph, tableCell) > ..`
    ChildOfNodeWithText,
}

/// A selector that a rule listens with.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Listener {
    /// The kinds of nodes that its last part matches.
    kinds: Kinds,
    within: Within,
    is_exit: bool,
    /// It is more than the name of a type. On one node ESLint calls such a listener after those that are only that.
    is_more_than_a_type: bool,
}

impl Listener {
    /// `selector`: as upstream writes it.
    pub(crate) const fn new(selector: &'static str, kinds: Kinds) -> Listener {
        let bytes = selector.as_bytes();
        let is_exit = matches!(bytes, [.., b':', b'e', b'x', b'i', b't']);
        let (mut is_more_than_a_type, mut at) = (false, 0);
        while at < bytes.len() - if is_exit { 5 } else { 0 } {
            is_more_than_a_type |= !bytes[at].is_ascii_alphabetic();
            at += 1;
        }
        Listener {
            kinds,
            within: Within::Anything,
            is_exit,
            is_more_than_a_type,
        }
    }

    pub(crate) const fn within(mut self, within: Within) -> Listener {
        self.within = within;
        self
    }
}

/// What a rule reports.
struct Report {
    message: Message,
    data: Vec<(&'static str, Vec<u8>)>,
    start: Loc,
    end: Loc,
    fix: Option<(Span, Vec<u8>)>,
}

/// `context` of a rule.
pub(crate) struct Context<'d> {
    pub(crate) document: &'d Document<'d>,
    reports: Vec<Report>,
}

/// A report that is being made.
pub(crate) struct Reported<'c>(&'c mut Report);

impl Reported<'_> {
    /// `fixer.replaceTextRange(span, text)`
    pub(crate) fn fix(self, span: Span, text: impl Into<Vec<u8>>) {
        self.0.fix = Some((span, text.into()));
    }
}

impl<'d> Context<'d> {
    /// `context.report({ loc: { start, end }, messageId, data })`
    pub(crate) fn report(
        &mut self,
        (start, end): (Loc, Loc),
        message: Message,
        data: &[(&'static str, &[u8])],
    ) -> Reported<'_> {
        self.reports.push(Report {
            message,
            data: data.iter().map(|it| (it.0, it.1.to_vec())).collect(),
            start,
            end,
            fix: None,
        });
        let last = self.reports.len() - 1;
        Reported(&mut self.reports[last])
    }

    /// `context.report({ node, .. })`, `context.report({ loc: node.position, .. })`
    pub(crate) fn report_node(
        &mut self,
        node: Node<'d>,
        message: Message,
        data: &[(&'static str, &[u8])],
    ) -> Reported<'_> {
        self.report((node.start(), node.end()), message, data)
    }

    /// From one index to another: `{ start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) }`
    pub(crate) fn locs(&self, start: i64, end: i64) -> Result<(Loc, Loc), OutOfRange> {
        Ok((
            self.document.loc_from_index(start)?,
            self.document.loc_from_index(end)?,
        ))
    }

    /// The bytes from one index to another.
    pub(crate) fn span(&self, start: i64, end: i64) -> Span {
        Span::new(self.document.offset_of(start), self.document.offset_of(end))
    }
}

pub(crate) trait Listens: Sized {
    const LISTENERS: &'static [Listener];

    /// What it keeps while a text is linted.
    type Seen<'d>: Default;

    /// `LISTENERS[listener]` matches `node`. `Err`: upstream throws.
    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        seen: &mut Self::Seen<'d>,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange>;
}

/// In the `impl Rule` of a rule that [`Listens`]: all but `META`, `new` and `validate`.
#[macro_export]
macro_rules! listens {
    () => {
        const ON: On = On::new().finish();
        type State<'a> = Document<'a>;

        fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
            Document::of(file)
        }

        fn finish(&self, cx: &mut Cx<'_, Self>) {
            $crate::listen::walk(self, cx);
        }
    };
}

/// ESLint's column -1 is `u32::MAX` there.
fn position_of(loc: Loc) -> Position {
    Position {
        line: loc.line as u32,
        column: (loc.column - 1) as u32,
    }
}

/// Walks the tree as ESLint does, and calls `rule` with what it listens for.
pub(crate) fn walk<'c, R>(rule: &R, cx: &'c Cx<'_, R>)
where
    R: Listens + for<'s> Rule<State<'s> = Document<'s>>,
{
    let document: &'c Document<'c> = &cx.state;
    let mut seen = R::Seen::<'c>::default();
    let mut context = Context {
        document,
        reports: Vec::new(),
    };
    // Whether it listens for anything that is in a heading, a paragraph or a cell.
    let looks_into_text = const {
        let (mut looks, mut at) = (false, 0);
        while at < R::LISTENERS.len() {
            looks |= R::LISTENERS[at].kinds.0 & !Kinds::BLOCKS.0 != 0;
            at += 1;
        }
        looks
    };
    // How many of the nodes that are open are headings, and how many are headings, paragraphs or cells.
    let (mut headings, mut with_text) = (0u32, 0u32);
    let mut call = |is_exit: bool, node: Node<'c>, headings: u32, with_text: u32| -> bool {
        let kind = node.kind();
        for (index, listener) in R::LISTENERS.iter().enumerate() {
            let is_match = listener.is_exit == is_exit
                && listener.kinds.has(kind)
                && match listener.within {
                    Within::Anything => true,
                    Within::Heading => headings > 0,
                    Within::NodeWithText => with_text > 0,
                    Within::ChildOfNodeWithText => {
                        (node.parent()).is_some_and(|parent| Kinds::WITH_TEXT.has(parent.kind()))
                    }
                };
            if !is_match {
                continue;
            }
            let thrown = rule.on(index, node, &mut seen, &mut context);
            for it in context.reports.drain(..) {
                let (start, end) = (document.offset_at(it.start), document.offset_at(it.end));
                let span = Span::new(
                    start.unwrap_or_else(|| node.span().start),
                    end.or(start).unwrap_or_else(|| node.span().start),
                );
                let mut report = cx.report(span, it.message);
                for (name, value) in it.data {
                    report = report.data(name, value);
                }
                if start.is_none() {
                    report = report.start_at(position_of(it.start));
                }
                if end.is_none() {
                    report = report.end_at(position_of(it.end));
                }
                report = match (kind, is_exit) {
                    (Kind::Root, true) => report.at_the_end(),
                    (_, true) => report.listened_on(node.span()).on_exit(true),
                    (_, false) if listener.is_more_than_a_type => {
                        report.listened_on(node.span()).by_selector()
                    }
                    (_, false) => report.listened_on(node.span()),
                };
                if let Some((span, text)) = it.fix {
                    report = report.fix(|fixer| fixer.replace(span, text));
                }
                drop(report);
            }
            if let Err(error) = thrown {
                let message = format!(
                    "Index out of range (requested index {}, but source text has length {}).",
                    error.index, error.length
                );
                cx.throw(node.span(), "RangeError", message);
                return false;
            }
        }
        true
    };
    let mut node = document.root();
    loop {
        let kind = node.kind();
        if !call(false, node, headings, with_text) {
            return;
        }
        let child = match looks_into_text || !Kinds::WITH_TEXT.has(kind) {
            true => node.first_child(),
            false => None,
        };
        if let Some(child) = child {
            headings += u32::from(kind == Kind::Heading);
            with_text += u32::from(Kinds::WITH_TEXT.has(kind));
            node = child;
            continue;
        }
        loop {
            if !call(true, node, headings, with_text) {
                return;
            }
            if let Some(next) = node.next() {
                node = next;
                break;
            }
            let Some(parent) = node.parent() else {
                return;
            };
            headings -= u32::from(parent.kind() == Kind::Heading);
            with_text -= u32::from(Kinds::WITH_TEXT.has(parent.kind()));
            node = parent;
        }
    }
}
