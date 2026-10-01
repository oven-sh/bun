// Port of the parts of internal/core that the node table uses: text.go.
pub type TextPos = i32;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct TextRange {
    pos: TextPos,
    end: TextPos,
}

pub const fn new_text_range(pos: i32, end: i32) -> TextRange {
    TextRange { pos, end }
}

pub const fn undefined_text_range() -> TextRange {
    TextRange { pos: -1, end: -1 }
}

impl TextRange {
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
}
