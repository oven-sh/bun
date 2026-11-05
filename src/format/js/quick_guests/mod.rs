//! What the quick way for JavaScript asks for the text of a template in another language: Prettier's `textToDoc`.
//!
//! Which template is in which language, its text with placeholders, and what is around the guest's document are the quick
//! way's own (`print/embed.rs` there, `css/embed.rs`, `graphql/embed.rs`, `markdown/embed.rs` and `html/in_js.rs` on the
//! long way). Here a text becomes a document, by the same functions as on the long way, and the document is written to
//! that of the file: `from_doc.rs` for a document of `css/doc.rs`, `from_ir.rs` for one of `ir/`. Markup writes to it
//! directly (`html/writer.rs`).
//!
//! Whatever isn't certain to be printed as the long way prints it is [`Answer::Refused`], and so is whatever the long way
//! has words for: the file goes the long way.

pub(crate) mod from_doc;
pub(crate) mod from_ir;

use self::from_doc::{FromDoc, Unwritten};
use self::from_ir::{FromIr, Last};
use crate::{FormatError, FormatOptions};
use crate::html::writer::{QuickBuffers, ToQuick};
use crate::js::context::JsFormatContext;
use bun_core::strings;
use bun_format_quick::{Answer, Guest, Guests, Sink};

/// The formatters of the other languages, and their memory from one text to the next.
#[derive(Default)]
pub(crate) struct QuickGuests {
    /// The options of the file.
    options: FormatOptions,
    path: Vec<u8>,
    /// The options for markup in the file, once there has been some: for HTML, for Angular.
    options_of_markup: [Option<FormatOptions>; 2],
    /// For what is written with `ir` elements.
    document: crate::Scratch,
    buffers: QuickBuffers,
    groups: Vec<bun_format_quick::GroupId>,
    css: crate::css::Scratch,
    graphql: crate::graphql::embed::Scratch,
    markdown: crate::markdown::embed::Scratch,
}

/// True if an escape has made half of a surrogate pair, which no formatter reads as it is.
fn has_lone_surrogate(text: &[u8]) -> bool {
    let mut from = 0;
    while let Some(at) = strings::index_of_char_pos(text, 0xED, from) {
        if text.get(at + 1).is_some_and(|&byte| byte >= 0xA0) {
            return true;
        }
        from = at + 1;
    }
    false
}

impl From<Unwritten> for Answer {
    fn from(_: Unwritten) -> Answer {
        Answer::Refused
    }
}

impl QuickGuests {
    /// Before a file is formatted with `options`.
    pub(crate) fn start_file(&mut self, options: &FormatOptions, path: &[u8]) {
        self.options.clone_from(options);
        self.path.clear();
        self.path.extend_from_slice(path);
        self.options_of_markup = [None, None];
    }

    fn style_sheet(&mut self, text: &[u8], sink: &mut Sink<'_>) -> Answer {
        let count = sink.hole_count().max(0) as usize;
        // The long way indents what is in it differently.
        if crate::front_matter::parse(text).is_some() {
            return Answer::Refused;
        }
        let document =
            crate::css::embed::document_of_template(text, count, &self.options, &mut self.css);
        match document.map(|document| FromDoc::new(sink).write(&document)) {
            None => Answer::NotRead,
            Some(Ok(())) => Answer::Written,
            Some(Err(unwritten)) => unwritten.into(),
        }
    }

    fn query<'q>(&mut self, text: &'q [u8], sink: &mut Sink<'q>) -> Answer {
        // The long way looks at that only after an escape.
        if std::str::from_utf8(text).is_err() {
            return Answer::Refused;
        }
        if !crate::graphql::embed::parse_text(text, &mut self.graphql) {
            return Answer::NotRead;
        }
        let context =
            JsFormatContext::without_file(self.options.clone(), &crate::js::comments::NO_COMMENTS);
        let graphql = &self.graphql;
        let root = crate::ir::run::write_with(context, text, &mut self.document, |f| {
            crate::graphql::embed::write_text(text, graphql, false, f);
        });
        let Ok(root) = root else {
            return Answer::Refused;
        };
        let storage = self.document.storage();
        self.groups.clear();
        // A line break comes before it.
        let translation = FromIr::new(sink, storage, text, &mut self.groups, Last::LineBreak, false);
        match translation.write(storage.interned(root)) {
            Ok(_) => Answer::Written,
            Err(unwritten) => unwritten.into(),
        }
    }

    fn markdown(&mut self, text: &[u8], sink: &mut Sink<'_>) -> Answer {
        let written = crate::markdown::embed::with_document_of_template(
            text,
            &self.options,
            &mut self.markdown,
            // Around a text that may be on one line with its backticks, the long way breaks lines that Prettier doesn't.
            |document, _| match from_doc::forces_break(document) {
                true => FromDoc::for_markdown(sink).write(document),
                false => Err(Unwritten::Unknown),
            },
        );
        match written {
            // There's no syntax error in Markdown. The long way has no words for the document, and lays out what is
            // around the template as if it had.
            None => Answer::Refused,
            Some(Ok(())) => Answer::Written,
            Some(Err(unwritten)) => unwritten.into(),
        }
    }

    fn markup<'q>(
        &mut self,
        text: &'q [u8],
        parser: crate::html::Parser,
        sink: &mut Sink<'q>,
    ) -> Answer {
        use crate::html::in_js;
        // What the long way changes in the text before it's read, and what it takes for a placeholder.
        if strings::contains_char(text, b'\r')
            || has_lone_surrogate(text)
            // Two line breaks in a row, or two blanks, of which the long way prints one.
            || strings::trim_js_whitespace(text).is_empty()
            || strings::count(text, in_js::PLACEHOLDER_START) != sink.hole_count().max(0) as usize
        {
            return Answer::Refused;
        }
        let slot = usize::from(parser == crate::html::Parser::Angular);
        let Some(options) = self.options_of_markup.get_mut(slot) else {
            return Answer::Refused;
        };
        let options = &*options
            .get_or_insert_with(|| in_js::options_in_template(&self.options, &self.path, parser));
        let tab_width = options.indent_width.value().max(1);
        let indent_level = sink.indentation_of_template(tab_width) / tab_width
            + u32::from(in_js::surrounding_line(text, options).is_some());
        let context =
            JsFormatContext::without_file(options.clone(), &crate::js::comments::NO_COMMENTS);
        let (mut result, buffers) = (None, &mut self.buffers);
        let root = crate::ir::run::write_with(context, text, &mut self.document, |f| {
            let quick = ToQuick::new(sink, buffers);
            result = Some(crate::html::write_document_to_quick(
                text,
                parser,
                options,
                indent_level,
                f,
                quick,
            ));
        });
        match (root, result) {
            (Ok(_), Some(Ok((top_level_count, None)))) => {
                sink.set_top_level_count(i32::try_from(top_level_count).unwrap_or(i32::MAX));
                Answer::Written
            }
            // What is around a template that's left alone for another reason is laid out as if it weren't.
            (_, Some(Err(FormatError::SyntaxError | FormatError::SyntaxErrorAt(_))))
                if !crate::html::can_be_parsed(text, parser) =>
            {
                Answer::NotRead
            }
            _ => Answer::Refused,
        }
    }
}

impl Guests for QuickGuests {
    fn knows(&self, guest: Guest) -> bool {
        match guest {
            Guest::Html | Guest::Angular => self.options.embedded_html,
            Guest::Scss | Guest::GraphQl | Guest::Markdown => true,
        }
    }

    fn format<'q>(&mut self, guest: Guest, text: &'q [u8], sink: &mut Sink<'q>) -> Answer {
        match guest {
            Guest::Scss => self.style_sheet(text, sink),
            Guest::GraphQl => self.query(text, sink),
            Guest::Markdown => self.markdown(text, sink),
            Guest::Html => self.markup(text, crate::html::Parser::Html, sink),
            Guest::Angular => self.markup(text, crate::html::Parser::Angular, sink),
        }
    }
}
