// core/text.go: TextPos and TextRange.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct TextRange {
    pub pos: i32,
    pub end: i32,
}

impl Default for TextRange {
    fn default() -> Self {
        undefined_text_range()
    }
}

impl TextRange {
    pub const fn new(pos: i32, end: i32) -> Self {
        Self { pos, end }
    }
    pub const fn len(self) -> i32 {
        self.end - self.pos
    }
    pub const fn is_valid(self) -> bool {
        self.pos >= 0 || self.end >= 0
    }
    pub const fn contains(self, pos: i32) -> bool {
        pos >= self.pos && pos < self.end
    }
    pub const fn contains_inclusive(self, pos: i32) -> bool {
        pos >= self.pos && pos <= self.end
    }
}

pub const fn undefined_text_range() -> TextRange {
    TextRange { pos: -1, end: -1 }
}
