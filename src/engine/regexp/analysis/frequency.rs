//! How often characters are expected in a subject.

use bun_engine_text::{CodeUnit, Text, with_text};

use crate::set::{CharRange, Latin1Set};

/// In 65536 characters of a mixture of prose, markup, data and source code.
#[rustfmt::skip]
const ASCII: [u16; 128] = [
    8, 8, 8, 8, 8, 8, 8, 8, 8, 200, 1900, 8, 8, 200, 8, 8,
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
    9600, 64, 1350, 130, 64, 80, 64, 230, 620, 620, 190, 64, 790, 1200, 970, 570,
    480, 380, 250, 240, 160, 190, 160, 140, 140, 130, 850, 540, 120, 540, 160, 64,
    64, 170, 130, 140, 110, 200, 90, 70, 70, 140, 64, 64, 100, 90, 110, 120,
    110, 64, 140, 200, 200, 70, 64, 70, 64, 64, 64, 170, 170, 150, 64, 200,
    300, 2650, 790, 1530, 1360, 4400, 900, 720, 900, 2300, 130, 320, 1780, 1120, 2560, 2670,
    1090, 90, 2750, 2500, 3460, 1220, 430, 400, 350, 520, 70, 420, 130, 420, 64, 8,
];
const OTHER_LATIN1: u16 = 4;
/// For each character, the sum for those before it.
static BELOW: [u32; 257] = {
    let (mut sums, mut c) = ([0; 257], 0);
    while c < 256 {
        let usual = if c < 128 { ASCII[c] } else { OTHER_LATIN1 };
        sums[c + 1] = sums[c] + usual as u32;
        c += 1;
    }
    sums
};
static BY_LOW_HALF: [u32; 16] = {
    let (mut sums, mut c) = ([0; 16], 0);
    while c < ASCII.len() {
        sums[c & 15] += ASCII[c] as u32;
        c += 1;
    }
    sums
};
const SCALE: f32 = 1.0 / 65536.0;

const SAMPLE: usize = 128;
const LEAST_SAMPLE: usize = 32;
const TRUST_IN_SAMPLE: f32 = 0.875;
/// Later subjects can differ from the sample.
const LEAST_OF_USUAL: f32 = 0.35;
const WIDE_WITHOUT_SAMPLE: f32 = 0.03;

pub(crate) struct Frequencies {
    sampled: Option<Sampled>,
}

struct Sampled {
    latin1: [u8; 256],
    seen: Latin1Set,
    /// By the high byte.
    pages: [u8; 256],
    weight_of_one: f32,
    wide: f32,
}

fn usual(first: u32, last: u32) -> f32 {
    (BELOW[last as usize + 1] - BELOW[first as usize]) as f32 * SCALE
}

impl Sampled {
    fn above_least(&self, c: u8) -> f32 {
        let usual = usual(c.into(), c.into()) * (1.0 - TRUST_IN_SAMPLE - LEAST_OF_USUAL);
        (usual + f32::from(self.latin1[usize::from(c)]) * self.weight_of_one).max(0.0)
    }
}

impl Frequencies {
    pub(crate) const USUAL: Frequencies = Frequencies { sampled: None };

    pub(crate) fn sample(&mut self, subject: Text<'_>) {
        if subject.len() < LEAST_SAMPLE {
            return;
        }
        let start = subject.len().saturating_sub(SAMPLE) / 2;
        let sample = subject.slice(start..subject.len().min(start + SAMPLE));
        let sampled = self.sampled.insert(Sampled {
            latin1: [0; 256],
            seen: Latin1Set::EMPTY,
            pages: [0; 256],
            weight_of_one: TRUST_IN_SAMPLE / sample.len() as f32,
            wide: 0.0,
        });
        let mut wide = 0u8;
        with_text!(sample, |units| for unit in units {
            match unit.to_u16().to_be_bytes() {
                [0, low] => {
                    sampled.latin1[usize::from(low)] += 1;
                    sampled.seen.insert(low);
                }
                [high, _] => {
                    sampled.pages[usize::from(high)] += 1;
                    wide += 1;
                }
            }
        });
        sampled.wide = f32::from(wide) * sampled.weight_of_one;
    }

    fn of_character(&self, c: u8) -> f32 {
        let usual = usual(c.into(), c.into());
        let with_sample = |it: &Sampled| usual * LEAST_OF_USUAL + it.above_least(c);
        self.sampled.as_ref().map_or(usual, with_sample)
    }

    pub(crate) fn of_latin1(&self, set: &Latin1Set) -> f32 {
        let sum = |set: Latin1Set| {
            let usual: f32 = set.ranges().map(|it| usual(it.first, it.last)).sum();
            self.sampled.as_ref().map_or(usual, |sampled| {
                let seen = (set & sampled.seen).iter();
                usual * LEAST_OF_USUAL + seen.map(|c| sampled.above_least(c)).sum::<f32>()
            })
        };
        if set.len() <= 128 {
            return sum(*set);
        }
        let all = 1.0 - self.sampled.as_ref().map_or(0.0, |sampled| sampled.wide);
        (all.max(LEAST_OF_USUAL) - sum(!*set)).max(0.0)
    }

    pub(crate) fn of_ascii_by_low_half(&self) -> [f32; 16] {
        let usual = BY_LOW_HALF.map(|it| it as f32 * SCALE);
        let Some(sampled) = &self.sampled else {
            return usual;
        };
        let mut shares = usual.map(|it| it * LEAST_OF_USUAL);
        for c in sampled.seen.iter().take_while(u8::is_ascii) {
            shares[usize::from(c & 15)] += sampled.above_least(c);
        }
        shares
    }

    /// The range is above Latin-1.
    pub(crate) fn of_wide(&self, range: CharRange) -> f32 {
        // A script uses a part of its pages, and that unevenly.
        let share = |units: u32, of: u32| (units as f32 * 8.0 / of as f32).min(1.0);
        let last = range.last.min(0xffff);
        let usual = WIDE_WITHOUT_SAMPLE * share(last - range.first + 1, 0x4000);
        let Some(sampled) = &self.sampled else {
            return usual;
        };
        let in_page = |page: u32| {
            let units = last.min(page << 8 | 0xff) - range.first.max(page << 8) + 1;
            f32::from(sampled.pages[page as usize]) * share(units, 0x100)
        };
        let seen = (range.first >> 8..=last >> 8).map(in_page).sum::<f32>();
        usual * (1.0 - TRUST_IN_SAMPLE) + seen * sampled.weight_of_one
    }

    pub(crate) fn of_range(&self, first: u16, last: u16) -> f32 {
        let mut latin1 = Latin1Set::EMPTY;
        if let Ok(first) = u8::try_from(first) {
            latin1.insert_range(first, last.min(0xff) as u8);
        }
        let latin1 = self.of_latin1(&latin1);
        match last {
            ..=0xff => latin1,
            _ => latin1 + self.of_wide(CharRange::new(first.max(0x100).into(), last.into())),
        }
    }

    pub(crate) fn of_unit(&self, unit: u16) -> f32 {
        match u8::try_from(unit) {
            Ok(c) => self.of_character(c),
            Err(_) => self.of_wide(CharRange::single(unit.into())),
        }
    }
}
