//! Tables of words in one string. A `[&str; N]` has a pointer and a length for each word, which is 16 bytes. A [`Words`] has
//! the offset of the word's end, which is 2.

use std::cmp::Ordering;

/// What words are sorted by.
#[derive(Clone, Copy)]
pub enum By {
    Bytes,
    /// The bytes, with ASCII letters in lowercase.
    AsciiLowercase,
}

/// `N` words with one separator between them. A word may be empty.
pub struct Words<const N: usize> {
    text: &'static str,
    /// Where each word ends.
    ends: [u16; N],
}

impl<const N: usize> Words<N> {
    /// The words have a space between them. Doesn't compile unless `text` has `N` words.
    pub const fn new(text: &'static str) -> Self {
        Self::separated_by(b' ', text)
    }

    pub const fn separated_by(separator: u8, text: &'static str) -> Self {
        let bytes = text.as_bytes();
        assert!(bytes.len() <= u16::MAX as usize);
        let mut ends = [0; N];
        let (mut at, mut count) = (0, 0);
        while at <= bytes.len() {
            if at == bytes.len() || bytes[at] == separator {
                ends[count] = at as u16;
                count += 1;
            }
            at += 1;
        }
        assert!(count == N);
        Words { text, ends }
    }

    /// Doesn't compile unless every `step`th word sorts before the next one. The lookups of [`List`] rely on that.
    pub const fn sorted(self, step: usize, by: By) -> Self {
        let bytes = self.text.as_bytes();
        let mut index = step;
        while index < N {
            // Where the two words start, and where they end.
            let (mut a, mut b) = (0, self.ends[index - 1] as usize + 1);
            if index > step {
                a = self.ends[index - step - 1] as usize + 1;
            }
            let (a_end, b_end) = (self.ends[index - step] as usize, self.ends[index] as usize);
            loop {
                assert!(b < b_end, "the words aren't sorted");
                if a == a_end {
                    break;
                }
                let (mut x, mut y) = (bytes[a], bytes[b]);
                if matches!(by, By::AsciiLowercase) {
                    (x, y) = (x.to_ascii_lowercase(), y.to_ascii_lowercase());
                }
                assert!(x <= y, "the words aren't sorted");
                if x < y {
                    break;
                }
                (a, b) = (a + 1, b + 1);
            }
            index += step;
        }
        self
    }

    #[inline]
    pub const fn list(&'static self) -> List {
        List {
            text: self.text,
            ends: &self.ends,
        }
    }
}

/// The words of a [`Words`], whatever their number.
#[derive(Copy, Clone)]
pub struct List {
    text: &'static str,
    ends: &'static [u16],
}

impl List {
    #[inline]
    fn range(self, index: usize) -> Option<std::ops::Range<usize>> {
        let before = self.ends.get(index.wrapping_sub(1));
        Some(before.map_or(0, |it| *it as usize + 1)..*self.ends.get(index)? as usize)
    }

    #[inline]
    pub fn get(self, index: usize) -> Option<&'static str> {
        self.text.get(self.range(index)?)
    }

    pub fn iter(self) -> impl Iterator<Item = &'static str> {
        (0..self.ends.len()).filter_map(move |index| self.get(index))
    }

    /// Looks at every `step`th word for `word`. They're sorted by what `fold` makes of their bytes.
    #[inline]
    fn search(self, step: usize, word: &[u8], fold: impl Fn(u8) -> u8) -> Option<usize> {
        let (mut low, mut high) = (0, self.ends.len() / step);
        while low < high {
            let middle = low + (high - low) / 2;
            let found = self.text.as_bytes().get(self.range(middle * step)?)?;
            // Most differ in one of the first bytes, so this beats a call of `memcmp`.
            let mut bytes = found.iter().zip(word);
            let order = match bytes.find(|(a, b)| a != b && fold(**a) != fold(**b)) {
                Some((a, b)) => fold(*a).cmp(&fold(*b)),
                None => found.len().cmp(&word.len()),
            };
            match order {
                Ordering::Equal => return Some(middle * step),
                Ordering::Less => low = middle + 1,
                Ordering::Greater => high = middle,
            }
        }
        None
    }

    /// For sorted words.
    #[inline]
    pub fn contains(self, word: &[u8]) -> bool {
        self.search(1, word, |it| it).is_some()
    }

    /// The word that equals `word` but for the case of ASCII letters. For words that are sorted without regard to it.
    #[inline]
    pub fn find_ignoring_ascii_case(self, word: &[u8]) -> Option<&'static str> {
        self.get(self.search(1, word, |it| it.to_ascii_lowercase())?)
    }

    /// The word after `key`. For keys and values in turn, sorted by key.
    #[inline]
    pub fn value_of(self, key: &[u8]) -> Option<&'static str> {
        self.get(self.search(2, key, |it| it)? + 1)
    }
}
