use core::cell::Cell;

use bun_engine_text::Text;

/// The last text that was parsed, if it was Latin-1 and not long, and its time value.
#[derive(Default)]
pub(super) struct LastParsed {
    length: Cell<usize>,
    /// Eight characters each. The one after the whole ones has the last eight.
    words: [Cell<u64>; 10],
    time: Cell<f64>,
}

impl LastParsed {
    pub(super) fn clear(&self) {
        self.length.set(0);
    }

    #[inline(always)]
    pub(super) fn time_or_else(&self, text: Text<'_>, parse: impl FnOnce() -> f64) -> f64 {
        if !self.replace(text) {
            self.time.set(parse());
        }
        self.time.get()
    }

    /// Returns whether it is the same text.
    #[inline(always)]
    fn replace(&self, text: Text<'_>) -> bool {
        if let Text::Latin1(characters) = text
            && let Some(last) = characters.last_chunk()
            && let (whole, _) = characters.as_chunks()
            && let Some((last_word, words)) =
                (self.words.get(..=whole.len())).and_then(|words| words.split_last())
        {
            let replace = |word: &Cell<u64>, chunk: &[u8; 8]| {
                let new = u64::from_ne_bytes(*chunk);
                word.replace(new) ^ new
            };
            let mut difference = replace(last_word, last);
            for (word, chunk) in words.iter().zip(whole) {
                difference |= replace(word, chunk);
            }
            return self.length.replace(text.len()) == text.len() && difference == 0;
        }
        self.clear();
        false
    }
}
