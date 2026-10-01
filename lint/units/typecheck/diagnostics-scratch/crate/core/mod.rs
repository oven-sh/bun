// Port of the parts of internal/core that diagnostics use: text.go and the line helpers of core.go.
pub type TextPos = i32;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct TextRange {
    pos: TextPos,
    end: TextPos,
}

impl TextRange {
    pub const fn new(pos: i32, end: i32) -> Self {
        Self { pos, end }
    }
    pub const fn undefined() -> Self {
        Self { pos: -1, end: -1 }
    }
    pub const fn pos(self) -> i32 {
        self.pos
    }
    pub const fn end(self) -> i32 {
        self.end
    }
    pub const fn len(self) -> i32 {
        self.end.wrapping_sub(self.pos)
    }
}

// utf8.DecodeRune: the rune and its width, (0xFFFD, 1) for a byte that starts no valid sequence.
pub fn decode_rune(bytes: &[u8]) -> (u32, usize) {
    let Some(&first) = bytes.first() else {
        return (0xFFFD, 0);
    };
    if first < 0x80 {
        return (u32::from(first), 1);
    }
    let width = match first {
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => return (0xFFFD, 1),
    };
    let Some(sequence) = bytes.get(..width) else {
        return (0xFFFD, 1);
    };
    match core::str::from_utf8(sequence) {
        Ok(text) => match text.chars().next() {
            Some(ch) => (u32::from(ch), width),
            None => (0xFFFD, 1),
        },
        Err(_) => (0xFFFD, 1),
    }
}

pub fn is_line_break(ch: u32) -> bool {
    ch == 0x0A || ch == 0x0D || ch == 0x2028 || ch == 0x2029
}

pub fn compute_ecma_line_starts(text: &[u8]) -> Vec<TextPos> {
    let mut result: Vec<TextPos> = Vec::new();
    let mut pos: usize = 0;
    let mut line_start: usize = 0;
    while let Some(&b) = text.get(pos) {
        if b < 0x80 {
            pos += 1;
            if b == b'\r' {
                if text.get(pos) == Some(&b'\n') {
                    pos += 1;
                }
            } else if b != b'\n' {
                continue;
            }
        } else {
            let (ch, size) = decode_rune(text.get(pos..).unwrap_or(b""));
            pos += size.max(1);
            if !is_line_break(ch) {
                continue;
            }
        }
        result.push(TextPos::try_from(line_start).unwrap_or(TextPos::MAX));
        line_start = pos;
    }
    result.push(TextPos::try_from(line_start).unwrap_or(TextPos::MAX));
    result
}

pub fn utf16_len(s: &[u8]) -> usize {
    let mut n: usize = 0;
    let mut i: usize = 0;
    while let Some(&b) = s.get(i) {
        if b < 0x80 {
            n += 1;
            i += 1;
            continue;
        }
        let (ch, size) = decode_rune(s.get(i..).unwrap_or(b""));
        n += if ch >= 0x10000 { 2 } else { 1 };
        i += size.max(1);
    }
    n
}
