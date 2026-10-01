// core/text.go: TextPos and TextRange. The default is Go's zero value; the range of a made node is undefined_text_range().
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct TextRange {
    pub pos: i32,
    pub end: i32,
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
    TextRange::undefined()
}
