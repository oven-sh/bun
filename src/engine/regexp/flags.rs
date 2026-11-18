use bun_engine_text::Text;

bitflags::bitflags! {
    /// In the order in which the `flags` getter lists them.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct Flags: u8 {
        const HAS_INDICES = 1 << 0;
        const GLOBAL = 1 << 1;
        const IGNORE_CASE = 1 << 2;
        const MULTILINE = 1 << 3;
        const DOT_ALL = 1 << 4;
        const UNICODE = 1 << 5;
        const UNICODE_SETS = 1 << 6;
        const STICKY = 1 << 7;
    }
}

const LETTERS: [u8; 8] = *b"dgimsuvy";

impl Flags {
    /// Those that a group can set and clear.
    pub(crate) const MODIFIABLE: Flags = Flags::IGNORE_CASE
        .union(Flags::MULTILINE)
        .union(Flags::DOT_ALL);

    pub(crate) const fn from_letter(letter: u16) -> Option<Flags> {
        Some(match letter {
            0x64 => Flags::HAS_INDICES,
            0x67 => Flags::GLOBAL,
            0x69 => Flags::IGNORE_CASE,
            0x6d => Flags::MULTILINE,
            0x73 => Flags::DOT_ALL,
            0x75 => Flags::UNICODE,
            0x76 => Flags::UNICODE_SETS,
            0x79 => Flags::STICKY,
            _ => return None,
        })
    }

    /// Nothing for an unknown or repeated letter, and for `u` together with `v`.
    pub fn parse(text: Text<'_>) -> Option<Flags> {
        let mut flags = Flags::empty();
        for letter in text.code_units() {
            let flag = Flags::from_letter(letter).filter(|&flag| !flags.contains(flag))?;
            flags |= flag;
        }
        (!flags.contains(Flags::UNICODE | Flags::UNICODE_SETS)).then_some(flags)
    }

    /// Whether the pattern and the subject are sequences of code points.
    #[inline]
    pub const fn is_unicode_aware(self) -> bool {
        self.intersects(Flags::UNICODE.union(Flags::UNICODE_SETS))
    }

    pub fn to_text(self) -> FlagsText {
        let mut text = FlagsText {
            letters: [0; 8],
            length: 0,
        };
        for (bit, letter) in LETTERS.into_iter().enumerate() {
            if self.bits() >> bit & 1 != 0 {
                text.letters[text.length] = letter;
                text.length += 1;
            }
        }
        text
    }
}

pub struct FlagsText {
    letters: [u8; 8],
    length: usize,
}

impl FlagsText {
    #[inline]
    pub fn text(&self) -> Text<'_> {
        Text::Latin1(&self.letters[..self.length])
    }
}
