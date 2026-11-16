//! Regular expressions over the kinds of characters, which are ASCII letters and digits.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

type Set = u128;

pub struct Pattern {
    first: Set,
    last: Set,
    /// For each letter in the pattern, those that may come next.
    follows: Vec<Set>,
    by_letter: [Set; 128],
}

struct Part {
    is_optional: bool,
    first: Set,
    last: Set,
}

fn members(mut set: Set) -> impl Iterator<Item = usize> {
    std::iter::from_fn(move || {
        let member = (set != 0).then(|| set.trailing_zeros() as usize)?;
        set &= set - 1;
        Some(member)
    })
}

impl Pattern {
    /// With `(a|b)`, `[ab]`, `?`, `*` and `+`.
    pub fn new(source: &str) -> Pattern {
        let mut pattern = Pattern {
            first: 0,
            last: 0,
            follows: Vec::new(),
            by_letter: [0; 128],
        };
        let all = pattern.choice(&mut source.as_bytes());
        Pattern {
            first: all.first,
            last: all.last,
            ..pattern
        }
    }

    fn link(&mut self, from: Set, to: Set) {
        members(from).for_each(|it| self.follows[it] |= to);
    }

    fn choice(&mut self, rest: &mut &[u8]) -> Part {
        let mut all = Part {
            is_optional: false,
            first: 0,
            last: 0,
        };
        loop {
            let one = self.sequence(rest);
            all = Part {
                is_optional: all.is_optional || one.is_optional,
                first: all.first | one.first,
                last: all.last | one.last,
            };
            if rest.split_off_first() != Some(&b'|') {
                return all;
            }
        }
    }

    fn sequence(&mut self, rest: &mut &[u8]) -> Part {
        let mut all = Part {
            is_optional: true,
            first: 0,
            last: 0,
        };
        while let Some(&start) = rest.first().filter(|it| !matches!(it, b'|' | b')')) {
            *rest = &rest[1..];
            let mut next = if start == b'(' {
                self.choice(rest)
            } else {
                let count = if start == b'[' {
                    rest.iter().take_while(|it| **it != b']').count() + 1
                } else {
                    0
                };
                let (letters, bit) = (
                    rest.split_off(..count).unwrap_or_default(),
                    1 << self.follows.len(),
                );
                self.follows.push(0);
                letters
                    .iter()
                    .chain([&start])
                    .for_each(|it| self.by_letter[usize::from(*it)] |= bit);
                Part {
                    is_optional: false,
                    first: bit,
                    last: bit,
                }
            };
            if let Some(&repeat @ (b'?' | b'*' | b'+')) = rest.first() {
                *rest = &rest[1..];
                next.is_optional |= repeat != b'+';
                self.link(if repeat == b'?' { 0 } else { next.last }, next.first);
            }
            self.link(all.last, next.first);
            all = Part {
                is_optional: all.is_optional && next.is_optional,
                first: all.first | if all.is_optional { next.first } else { 0 },
                last: next.last | if next.is_optional { all.last } else { 0 },
            };
        }
        all
    }

    /// The length of the longest match at the start.
    pub fn longest(&self, letters: &[u8]) -> usize {
        let (mut possible, mut longest) = (self.first, 0);
        for (index, letter) in letters.iter().enumerate() {
            let matched = possible & self.by_letter[usize::from(letter & 127)];
            if matched == 0 {
                break;
            }
            longest = if matched & self.last != 0 {
                index + 1
            } else {
                longest
            };
            possible = members(matched).fold(0, |all, it| all | self.follows[it]);
        }
        longest
    }
}
