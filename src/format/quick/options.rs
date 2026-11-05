//! Prettier's options. A host that runs a guest with other options sets them before embed() and puts them back after it.

use crate::Quick;

pub(crate) struct Options {
    pub(crate) print_width: i32,
    pub(crate) tab_width: i32,
    pub(crate) use_tabs: bool,
    pub(crate) semi: bool,
    pub(crate) single_quote: bool,
    pub(crate) jsx_single_quote: bool,
    pub(crate) quote_props: i32,
    pub(crate) trailing_comma: i32,
    pub(crate) bracket_spacing: bool,
    pub(crate) object_wrap_preserve: bool,
    pub(crate) bracket_same_line: bool,
    pub(crate) arrow_parens_always: bool,
    pub(crate) end_of_line: i32,
    pub(crate) single_attribute_per_line: bool,
    pub(crate) operator_position_start: bool,
    pub(crate) html_whitespace_sensitivity: i32,
    pub(crate) embedded_language_formatting_auto: bool,
    pub(crate) is_in_markdown: bool,
    /// See `Options::marks_line_breaks_in_texts` of root.rs.
    pub(crate) marks_line_breaks_in_texts: bool,
    /// See `Options::indentation` of root.rs.
    pub(crate) indentation: i32,
    /// The name of the file ends in ".ts".
    pub(crate) name_ends_in_ts: bool,
    /// The name of the file ends in ".js.flow".
    pub(crate) name_ends_in_js_flow: bool,
    pub(crate) in_js_template: bool,
    /// A language may take short cuts that rest on a guess about the layout, see fitted() of doc.rs. Off while a file is formatted for the
    /// second time because a guess was wrong, and wherever more than the text is asked for (a cursor, a range).
    pub(crate) short_cuts: bool,
    /// How many columns a guess leaves free, and whether guesses are made at all. A wrong guess costs a second run over the file, and where the options make for
    /// another layout than the sources have (a wider indentation, a narrower line), guesses are wrong more often. What counts is the bytes that are formatted twice: a
    /// short cut that takes a tenth off a file is a loss if a tenth of the bytes go round again. So they are counted, over windows of 64 files, and where more than one byte in 24
    /// is lost the next thousand files are guessed about with two levels of indentation to spare; if that is not enough, not at all. This changes what a run costs, never
    /// what it prints.
    pub(crate) guess_margin: i32,
    pub(crate) guessing: bool,
    /// 0: guesses as they come; 1: with a margin; 2: none
    pub(crate) care: i32,
    pub(crate) guessed_files: i32,
    pub(crate) guessed_bytes: i32,
    pub(crate) wrong_guesses: i32,
    pub(crate) wrong_bytes: i32,
    pub(crate) careful_windows: i32,
}
impl Options {
    pub(crate) fn new() -> Self {
        Self {
            print_width: 80,
            tab_width: 2,
            use_tabs: false,
            semi: true,
            single_quote: false,
            jsx_single_quote: false,
            quote_props: 0,
            trailing_comma: 2,
            bracket_spacing: true,
            object_wrap_preserve: true,
            bracket_same_line: false,
            arrow_parens_always: true,
            end_of_line: 0,
            single_attribute_per_line: false,
            operator_position_start: false,
            html_whitespace_sensitivity: 0,
            embedded_language_formatting_auto: true,
            is_in_markdown: false,
            marks_line_breaks_in_texts: false,
            indentation: 0,
            name_ends_in_ts: false,
            name_ends_in_js_flow: false,
            in_js_template: false,
            short_cuts: false,
            guess_margin: 0,
            guessing: true,
            care: 0,
            guessed_files: 0,
            guessed_bytes: 0,
            wrong_guesses: 0,
            wrong_bytes: 0,
            careful_windows: 0,
        }
    }
}

pub(crate) const QUOTE_PROPS_AS_NEEDED: i32 = 0;
pub(crate) const QUOTE_PROPS_CONSISTENT: i32 = 1;
pub(crate) const QUOTE_PROPS_PRESERVE: i32 = 2;
pub(crate) const TRAILING_COMMA_NONE: i32 = 0;
pub(crate) const TRAILING_COMMA_ES5: i32 = 1;
pub(crate) const TRAILING_COMMA_ALL: i32 = 2;
pub(crate) const EOL_LF: i32 = 0;
pub(crate) const EOL_CRLF: i32 = 1;
pub(crate) const EOL_CR: i32 = 2;
pub(crate) const EOL_AUTO: i32 = 3;
pub(crate) const WHITESPACE_CSS: i32 = 0;
pub(crate) const WHITESPACE_IGNORE: i32 = 2;
impl Quick {
    pub(crate) fn set_short_cuts(&mut self, value: bool) {
        self.options.short_cuts = value;
    }

    pub(crate) fn note_guess(&mut self, was_wrong: bool, bytes: i32) {
        self.options.guessed_files += 1;
        self.options.guessed_bytes += bytes >> 4;
        if was_wrong {
            self.options.wrong_guesses += 1;
            self.options.wrong_bytes += bytes >> 4;
        }
        if self.options.guessed_files < 64 && self.options.wrong_guesses < 2 {
            return;
        }
        if self.options.wrong_guesses >= 2
            && self.options.wrong_bytes.wrapping_mul(24) > self.options.guessed_bytes
        {
            if self.options.care < 2 {
                self.options.care += 1;
            }
            self.options.careful_windows = 16;
        } else if self.options.guessed_files < 64 {
            return;
        } else if self.options.careful_windows > 0 {
            self.options.careful_windows -= 1;
            if self.options.careful_windows == 0 && self.options.care > 0 {
                self.options.care -= 1;
                if self.options.care > 0 {
                    self.options.careful_windows = 16;
                }
            }
        }
        self.options.guess_margin = if self.options.care == 1 {
            2 * self.options.tab_width
        } else {
            0
        };
        self.options.guessing = self.options.care < 2;
        self.options.wrong_bytes = 0;
        self.options.wrong_guesses = 0;
        self.options.guessed_bytes = 0;
        self.options.guessed_files = 0;
    }

    // ---- setters, for hosts
    pub(crate) fn set_end_of_line(&mut self, eol: i32) {
        self.options.end_of_line = eol;
    }

    pub(crate) fn set_print_width(&mut self, width: i32) {
        self.options.print_width = width;
    }

    pub(crate) fn set_in_js_template(&mut self, value: bool) {
        self.options.in_js_template = value;
    }
}
