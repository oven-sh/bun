use crate::doc::DOC_START;
use crate::lang::lang;
use crate::options::{
    EOL_AUTO, EOL_CR, EOL_CRLF, EOL_LF, QUOTE_PROPS_AS_NEEDED, QUOTE_PROPS_CONSISTENT,
    QUOTE_PROPS_PRESERVE, TRAILING_COMMA_ALL, TRAILING_COMMA_ES5, TRAILING_COMMA_NONE,
};
use crate::text::SRC_BASE;
use crate::{Bytes, Quick, R, Stop, Words, why};

impl Quick {
    /// Turns "\r\n" and "\r" into "\n" in place. Returns the new length.
    pub(crate) fn normalize_end_of_line(&mut self, length: i32) -> i32 {
        let end = SRC_BASE + length;
        // The buffer is as large as the largest file so far: a "\r" behind the text keeps the search from running through all of it.
        self.t.put(end, 13);
        let first = self.t.index_of(13, SRC_BASE);
        if first < 0 || first >= end {
            if self.options.end_of_line == EOL_AUTO {
                self.set_end_of_line(EOL_LF);
            }
            return length;
        }
        if self.options.end_of_line == EOL_AUTO {
            // the first line ending decides
            let first_lf = self.t.index_of(10, SRC_BASE);
            if first_lf >= 0 && first_lf < first {
                self.set_end_of_line(EOL_LF);
            } else {
                self.set_end_of_line(if self.t.at(first + 1) == 10 {
                    EOL_CRLF
                } else {
                    EOL_CR
                });
            }
        }
        let mut w = first;
        let mut r = first;
        while r < end {
            let c = self.t.at(r);
            if c == 13 {
                self.t.put(
                    {
                        let v0 = w;
                        w += 1;
                        v0
                    },
                    10,
                );
                if self.t.at(r + 1) == 10 {
                    r += 1;
                }
            } else {
                self.t.put(
                    {
                        let v1 = w;
                        w += 1;
                        v1
                    },
                    c,
                );
            }
            r += 1;
        }
        return w - SRC_BASE;
    }
}

/// The quick way does not print this file: the long way does, or says what is wrong with it.
#[derive(Debug)]
pub struct Refused;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Language {
    /// JavaScript, with JSX; Flow if the file says so.
    JavaScript,
    /// Flow as its own parser reads it.
    Flow,
    /// Flow as Babel reads it.
    BabelFlow,
    TypeScript,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QuoteProps {
    AsNeeded,
    Consistent,
    Preserve,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrailingComma {
    None,
    Es5,
    All,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EndOfLine {
    Lf,
    Crlf,
    Cr,
    Auto,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub print_width: i32,
    pub tab_width: i32,
    pub use_tabs: bool,
    pub semi: bool,
    pub single_quote: bool,
    pub jsx_single_quote: bool,
    pub quote_props: QuoteProps,
    pub trailing_comma: TrailingComma,
    pub bracket_spacing: bool,
    pub object_wrap_preserve: bool,
    pub bracket_same_line: bool,
    pub arrow_parens_always: bool,
    pub end_of_line: EndOfLine,
    pub single_attribute_per_line: bool,
    pub experimental_ternaries: bool,
    pub operator_position_start: bool,
    pub embedded_language_formatting_auto: bool,
    /// Everything goes through the tokens, the tree and the document.
    pub no_short_cuts: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            print_width: 80,
            tab_width: 2,
            use_tabs: false,
            semi: true,
            single_quote: false,
            jsx_single_quote: false,
            quote_props: QuoteProps::AsNeeded,
            trailing_comma: TrailingComma::All,
            bracket_spacing: true,
            object_wrap_preserve: true,
            bracket_same_line: false,
            arrow_parens_always: true,
            end_of_line: EndOfLine::Lf,
            single_attribute_per_line: false,
            experimental_ternaries: false,
            operator_position_start: false,
            embedded_language_formatting_auto: true,
            no_short_cuts: false,
        }
    }
}

/// A file that is longer is refused, so that sums of positions stay far from the largest number.
const LONGEST_FILE: usize = 1 << 28;

fn ends_with_ignoring_case(name: &[u8], end: &[u8]) -> bool {
    name.len() >= end.len()
        && name
            .iter()
            .rev()
            .zip(end.iter().rev())
            .all(|(a, b)| a.to_ascii_lowercase() == *b)
}

impl Quick {
    /// Formats `text`, the contents of the file `name`. The result is `output()`.
    pub fn format(
        &mut self,
        text: &[u8],
        language: Language,
        name: &[u8],
        options: &Options,
    ) -> Result<(), Refused> {
        if text.len() > LONGEST_FILE {
            return Err(Refused);
        }
        let length = text.len() as i32;
        self.set_options(options, name);
        self.source_buffer(length, 0);
        self.t.set_all(text, SRC_BASE);
        let language = match language {
            Language::JavaScript => lang::Babel,
            Language::Flow => lang::Flow,
            Language::BabelFlow => lang::BabelFlow,
            Language::TypeScript => lang::TypeScript,
        };
        self.why = why::NONE;
        match self.format_buffer(length, language, options, name) {
            Ok(()) => Ok(()),
            Err(Stop) => Err(Refused),
        }
    }

    pub fn output(&self) -> &[u8] {
        self.printer.out.sub(0, self.printer.out_length)
    }

    /// The file started with a byte order mark, which is not part of the output.
    pub fn had_bom(&self) -> bool {
        self.had_bom
    }

    fn set_options(&mut self, o: &Options, name: &[u8]) {
        let to = &mut self.options;
        to.print_width = o.print_width.min(0x1fffffff);
        to.tab_width = o.tab_width;
        to.use_tabs = o.use_tabs;
        to.semi = o.semi;
        to.single_quote = o.single_quote;
        to.jsx_single_quote = o.jsx_single_quote;
        to.quote_props = match o.quote_props {
            QuoteProps::AsNeeded => QUOTE_PROPS_AS_NEEDED,
            QuoteProps::Consistent => QUOTE_PROPS_CONSISTENT,
            QuoteProps::Preserve => QUOTE_PROPS_PRESERVE,
        };
        to.trailing_comma = match o.trailing_comma {
            TrailingComma::None => TRAILING_COMMA_NONE,
            TrailingComma::Es5 => TRAILING_COMMA_ES5,
            TrailingComma::All => TRAILING_COMMA_ALL,
        };
        to.bracket_spacing = o.bracket_spacing;
        to.object_wrap_preserve = o.object_wrap_preserve;
        to.bracket_same_line = o.bracket_same_line;
        to.arrow_parens_always = o.arrow_parens_always;
        to.end_of_line = match o.end_of_line {
            EndOfLine::Lf => EOL_LF,
            EndOfLine::Crlf => EOL_CRLF,
            EndOfLine::Cr => EOL_CR,
            EndOfLine::Auto => EOL_AUTO,
        };
        to.single_attribute_per_line = o.single_attribute_per_line;
        to.experimental_ternaries = o.experimental_ternaries;
        to.operator_position_start = o.operator_position_start;
        to.embedded_language_formatting_auto = o.embedded_language_formatting_auto;
        to.name_ends_in_ts = name.ends_with(b".ts");
        to.name_ends_in_js_flow = name.ends_with(b".js.flow");
        self.name_is_common_js =
            ends_with_ignoring_case(name, b".cjs") || ends_with_ignoring_case(name, b".cts");
        // Whether `<a>` is an element or a type assertion depends on the name of the file. Without one that says so, both are tried.
        self.name_says_jsx = if [&b".ts"[..], b".mts", b".cts"]
            .iter()
            .any(|end| ends_with_ignoring_case(name, end))
        {
            0
        } else if [&b".js"[..], b".mjs", b".cjs", b".jsx", b".tsx"]
            .iter()
            .any(|end| ends_with_ignoring_case(name, end))
        {
            1
        } else {
            -1
        };
    }

    fn format_buffer(
        &mut self,
        mut length: i32,
        language: i32,
        options: &Options,
        name: &[u8],
    ) -> R<()> {
        self.had_bom = length >= 3
            && self.t.at(SRC_BASE) == 0xef
            && self.t.at(SRC_BASE + 1) == 0xbb
            && self.t.at(SRC_BASE + 2) == 0xbf;
        if self.had_bom {
            self.t
                .move_within(SRC_BASE, SRC_BASE + 3, SRC_BASE + length);
            length -= 3;
        }
        length = self.normalize_end_of_line(length);
        if options.no_short_cuts {
            return self.format_normalized(length, language);
        }
        self.set_short_cuts(true);
        let mut result = self.format_normalized(length, language);
        if result.is_ok() {
            self.note_guess(false, length);
        } else if self.why == why::REDO {
            // A guess about the layout was wrong. The text is still there: once more, without guessing.
            self.redone += 1;
            self.note_guess(true, length);
            self.set_short_cuts(false);
            self.unwind_source(0);
            let end_of_line = self.options.end_of_line;
            self.set_options(options, name);
            self.options.end_of_line = end_of_line;
            self.why = why::NONE;
            result = self.format_normalized(length, language);
        }
        self.set_short_cuts(false);
        result
    }

    /// `!text.trim()`
    fn is_blank(&self, length: i32) -> bool {
        let mut rest = self.t.sub(SRC_BASE, SRC_BASE + length);
        loop {
            rest = match rest {
                [] => return true,
                [32 | 9..=13, rest @ ..] => rest,
                [0xc2, 0xa0, rest @ ..] => rest,
                [0xe1, 0x9a, 0x80, rest @ ..] => rest,
                [0xe2, 0x80, 0x80..=0x8a | 0xa8 | 0xa9 | 0xaf, rest @ ..] => rest,
                [0xe2, 0x81, 0x9f, rest @ ..] => rest,
                [0xe3, 0x80, 0x80, rest @ ..] => rest,
                [0xef, 0xbb, 0xbf, rest @ ..] => rest,
                _ => return false,
            };
        }
    }

    /// The same for a text without a byte order mark and with "\n" at the end of its lines.
    fn format_normalized(&mut self, length: i32, language: i32) -> R<()> {
        self.set_source_length(length);
        if self.is_blank(length) {
            self.print_nothing();
            return Ok(());
        }
        self.reset_ast(length * 2 + 1024);
        self.reset_doc(length * 2 + 4096);
        self.reset_filters();
        self.begin_root(language);
        self.format_js()?;
        let stub = self.end_doc();
        self.stage(2);
        self.print_doc(DOC_START, stub)?;
        self.stage(3);
        Ok(())
    }

    /// How many files were formatted twice.
    pub fn redone(&self) -> i32 {
        self.redone
    }

    #[inline(always)]
    pub(crate) fn stage(&mut self, _stage: i32) {
        #[cfg(feature = "stages")]
        self.note_stage(_stage);
    }
}

/// For tools that compare what each stage leaves behind.
#[cfg(feature = "stages")]
impl Quick {
    fn note_stage(&mut self, stage: i32) {
        fn hash_words(words: &[i32], from: (i32, i32)) -> (i32, i32) {
            let (mut h1, mut h2) = from;
            for &w in words {
                h1 = (h1 ^ w).wrapping_mul(16777619);
                h2 = h2.wrapping_add(w).wrapping_mul(0x9e3779b1u32 as i32)
                    ^ ((h2 as u32) >> 15) as i32;
            }
            (h1, h2)
        }
        let h = match stage {
            0 | 1 => hash_words(
                self.lexer.c.sub(0, self.lexer.c_count * 8),
                hash_words(self.n.sub(0, self.arena.n_pos), (1, 2)),
            ),
            2 => hash_words(self.d.sub(0, self.doc.d_pos), (1, 2)),
            _ => (0, 0),
        };
        let h = ((h.0 as u32 as u64) << 32) | h.1 as u32 as u64;
        if let Some(slot) = self.stages.get_mut(stage as usize) {
            *slot = h;
        }
        if self.keep_stages {
            match stage {
                0 | 1 => {
                    let mut words = self.n.sub(0, self.arena.n_pos).to_vec();
                    words.push(-1);
                    words.extend_from_slice(self.lexer.c.sub(0, self.lexer.c_count * 8));
                    self.kept.push(words);
                }
                2 => self.kept.push(self.d.sub(0, self.doc.d_pos).to_vec()),
                _ => {}
            }
        }
    }
    pub fn stages(&self) -> [u64; 4] {
        self.stages
    }
    pub fn clear_stages(&mut self, keep: bool) {
        self.stages = [0; 4];
        self.keep_stages = keep;
        self.kept.clear();
    }
    pub fn kept(&self) -> &[Vec<i32>] {
        &self.kept
    }
    pub fn why(&self) -> i32 {
        self.why
    }
    pub fn failed_at(&self) -> i32 {
        self.failed_at
    }
}
