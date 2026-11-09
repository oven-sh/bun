//! Case-changing utilities for the `Bun.*Case` functions (see #15087).
//!
//! Word splitting and transforms match the `change-case` npm package:
//! words split on case transitions (lower/digit -> upper, upper -> upper+lower)
//! and on any non-letter/non-digit separator; each case then joins the words
//! with its separator and per-word casing.
//!
//! The splitting rules are `change-case`'s regexes, as a state machine:
//! `([\p{Ll}\d])(\p{Lu})` and `(\p{Lu})([\p{Lu}][\p{Ll}])`, with
//! `[^\p{L}\d]` as separators. A letter that is neither lowercase nor
//! uppercase (a modifier letter like `ʼ`, a CJK character, a titlecase
//! digraph) is a word character that never triggers a boundary: it continues
//! the word and resets the boundary state, exactly as the regexes do, since
//! neither pattern can match across it.
//!
//! Case mapping uses Rust's `char::to_uppercase`/`to_lowercase`, which do
//! full Unicode mappings (e.g. `ß` -> `SS`), matching JavaScript's
//! `String.prototype.toUpperCase`/`toLowerCase` — and therefore `change-case` —
//! rather than the single-codepoint mapping ICU does.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Case {
    Camel,
    Capital,
    Constant,
    Dot,
    Kebab,
    Pascal,
    Snake,
    Train,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Transform {
    Lower,
    Upper,
    Capitalize,
}

impl Case {
    fn separator(self) -> Option<char> {
        match self {
            Case::Camel | Case::Pascal => None,
            Case::Snake | Case::Constant => Some('_'),
            Case::Kebab | Case::Train => Some('-'),
            Case::Dot => Some('.'),
            Case::Capital => Some(' '),
        }
    }

    fn transform(self, word_index: usize) -> Transform {
        match self {
            Case::Camel => {
                if word_index == 0 {
                    Transform::Lower
                } else {
                    Transform::Capitalize
                }
            }
            Case::Pascal | Case::Capital | Case::Train => Transform::Capitalize,
            Case::Snake | Case::Kebab | Case::Dot => Transform::Lower,
            Case::Constant => Transform::Upper,
        }
    }

    /// camelCase and PascalCase insert `_` before a word starting with a digit
    /// (matching `change-case`: `camelCase("version 1.2.10")` is `"version_1_2_10"`).
    fn digit_prefix_underscore(self) -> bool {
        matches!(self, Case::Camel | Case::Pascal)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    /// A lowercase letter (`\p{Ll}`; Rust's `is_lowercase`).
    Lower,
    /// An uppercase letter (`\p{Lu}`; Rust's `is_uppercase`).
    Upper,
    /// An ASCII digit.
    Digit,
    /// A letter that is neither lowercase nor uppercase (e.g. `ʼ`, CJK,
    /// titlecase digraphs): a word character that never triggers a boundary.
    Neutral,
    /// Anything else: a separator.
    Other,
}

fn classify(c: char) -> Class {
    if c.is_ascii() {
        if c.is_ascii_lowercase() {
            return Class::Lower;
        }
        if c.is_ascii_uppercase() {
            return Class::Upper;
        }
        if c.is_ascii_digit() {
            return Class::Digit;
        }
        return Class::Other;
    }
    // Non-ASCII: `is_uppercase`/`is_lowercase` are the Unicode Uppercase /
    // Lowercase properties, which match `\p{Lu}` / `\p{Ll}` except for a few
    // Roman numerals and modifier letters; `is_alphabetic` matches `\p{L}`
    // except for a few combining marks.
    if c.is_uppercase() {
        return Class::Upper;
    }
    if c.is_lowercase() {
        return Class::Lower;
    }
    if c.is_alphabetic() {
        return Class::Neutral;
    }
    Class::Other
}

/// Splits `input` into words, yielding each word as a `&str`.
///
/// Word boundaries follow `change-case`:
/// 1. lower/digit -> upper (`"camelCase"` -> `"camel"` + `"Case"`)
/// 2. upper -> upper+lower (`"XMLParser"` -> `"XML"` + `"Parser"`)
/// 3. any non-letter/non-digit character is a separator.
/// A neutral letter (neither lower nor upper) continues the word and resets
/// the boundary state, so no boundary is ever detected across it.
struct Words<'a> {
    input: &'a str,
    chars: std::str::CharIndices<'a>,
    prev_class: Class,
    prev_prev_class: Class,
    /// Byte index where the previous character started.
    prev_byte_pos: usize,
    in_word: bool,
    word_start: usize,
    word_end: usize,
    done: bool,
}

impl<'a> Words<'a> {
    fn new(input: &'a str) -> Self {
        Words {
            input,
            chars: input.char_indices(),
            prev_class: Class::Other,
            prev_prev_class: Class::Other,
            prev_byte_pos: 0,
            in_word: false,
            word_start: 0,
            word_end: 0,
            done: false,
        }
    }
}

impl<'a> Iterator for Words<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<&'a str> {
        while !self.done {
            let Some((cur_pos, cur_char)) = self.chars.next() else {
                self.done = true;
                if self.in_word {
                    self.in_word = false;
                    return Some(&self.input[self.word_start..self.word_end]);
                }
                return None;
            };
            let cur_class = classify(cur_char);
            let cur_end = cur_pos + cur_char.len_utf8();

            if cur_class == Class::Other {
                if self.in_word {
                    self.in_word = false;
                    self.prev_class = Class::Other;
                    self.prev_prev_class = Class::Other;
                    return Some(&self.input[self.word_start..self.word_end]);
                }
                self.prev_class = Class::Other;
                self.prev_prev_class = Class::Other;
                continue;
            }

            if !self.in_word {
                self.in_word = true;
                self.word_start = cur_pos;
                self.word_end = cur_end;
                self.prev_prev_class = Class::Other;
                self.prev_class = cur_class;
                self.prev_byte_pos = cur_pos;
                continue;
            }

            // Rule 2: upper -> upper+lower splits before the last upper.
            if self.prev_prev_class == Class::Upper
                && self.prev_class == Class::Upper
                && cur_class == Class::Lower
            {
                let completed = &self.input[self.word_start..self.prev_byte_pos];
                self.word_start = self.prev_byte_pos;
                self.word_end = cur_end;
                self.prev_prev_class = self.prev_class;
                self.prev_class = cur_class;
                self.prev_byte_pos = cur_pos;
                return Some(completed);
            }

            // Rule 1: (lower | digit) -> upper splits before the upper.
            if (self.prev_class == Class::Lower || self.prev_class == Class::Digit)
                && cur_class == Class::Upper
            {
                let completed = &self.input[self.word_start..self.word_end];
                self.word_start = cur_pos;
                self.word_end = cur_end;
                self.prev_prev_class = Class::Other;
                self.prev_class = cur_class;
                self.prev_byte_pos = cur_pos;
                return Some(completed);
            }

            self.word_end = cur_end;
            self.prev_prev_class = self.prev_class;
            self.prev_class = cur_class;
            self.prev_byte_pos = cur_pos;
        }

        None
    }
}

/// Convert `input` to `case`, matching the `change-case` npm package.
pub(crate) fn convert(case: Case, input: &str) -> String {
    let mut out = String::with_capacity(input.len() + input.len() / 4);
    let mut word_index = 0;

    for word in Words::new(input) {
        if word_index > 0 {
            if let Some(sep) = case.separator() {
                out.push(sep);
            }
        }

        if word_index > 0
            && case.digit_prefix_underscore()
            && word.chars().next().is_some_and(|c| c.is_ascii_digit())
        {
            out.push('_');
        }

        let mut chars = word.chars();
        match case.transform(word_index) {
            Transform::Lower => {
                for c in chars {
                    out.extend(c.to_lowercase());
                }
            }
            Transform::Upper => {
                for c in chars {
                    out.extend(c.to_uppercase());
                }
            }
            Transform::Capitalize => {
                if let Some(first) = chars.next() {
                    out.extend(first.to_uppercase());
                }
                for c in chars {
                    out.extend(c.to_lowercase());
                }
            }
        }

        word_index += 1;
    }

    out
}
