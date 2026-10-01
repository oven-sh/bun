// internal/core/text.go

// TextPos
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct TextPos(pub i32);

// TextRange
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct TextRange {
    pos: TextPos,
    end: TextPos,
}

pub const fn new_text_range(pos: i32, end: i32) -> TextRange {
    TextRange {
        pos: TextPos(pos),
        end: TextPos(end),
    }
}

pub const fn undefined_text_range() -> TextRange {
    TextRange {
        pos: TextPos(-1),
        end: TextPos(-1),
    }
}

impl TextRange {
    pub const fn pos(self) -> i32 {
        self.pos.0
    }

    pub const fn end(self) -> i32 {
        self.end.0
    }

    pub const fn len(self) -> i32 {
        self.end.0.wrapping_sub(self.pos.0)
    }

    pub const fn is_valid(self) -> bool {
        self.pos.0 >= 0 || self.end.0 >= 0
    }

    pub const fn contains(self, pos: i32) -> bool {
        pos >= self.pos.0 && pos < self.end.0
    }

    pub const fn contains_inclusive(self, pos: i32) -> bool {
        pos >= self.pos.0 && pos <= self.end.0
    }

    pub const fn contains_exclusive(self, pos: i32) -> bool {
        self.pos.0 < pos && pos < self.end.0
    }

    pub const fn with_pos(self, pos: i32) -> TextRange {
        TextRange {
            pos: TextPos(pos),
            end: self.end,
        }
    }

    pub const fn with_end(self, end: i32) -> TextRange {
        TextRange {
            pos: self.pos,
            end: TextPos(end),
        }
    }

    pub const fn contained_by(self, t2: TextRange) -> bool {
        t2.pos.0 <= self.pos.0 && t2.end.0 >= self.end.0
    }

    pub fn overlaps(self, t2: TextRange) -> bool {
        let start = self.pos.max(t2.pos);
        let end = self.end.min(t2.end);
        start < end
    }

    // Similar to Overlaps, but treats touching ranges as intersecting. For example, [0, 5) intersects [5, 10).
    pub fn intersects(self, t2: TextRange) -> bool {
        let start = self.pos.max(t2.pos);
        let end = self.end.min(t2.end);
        start <= end
    }
}

pub fn compare_text_ranges(r1: TextRange, r2: TextRange) -> isize {
    let c = r1.pos.0 as isize - r2.pos.0 as isize;
    if c != 0 {
        return c;
    }
    r1.end.0 as isize - r2.end.0 as isize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_range() {
        let r = new_text_range(3, 8);
        assert_eq!((r.pos(), r.end(), r.len()), (3, 8, 5));
        assert!(r.is_valid() && !undefined_text_range().is_valid());
        assert!(TextRange::default().is_valid());
        assert!(r.contains(3) && r.contains(7) && !r.contains(8));
        assert!(r.contains_inclusive(8) && !r.contains_inclusive(9));
        assert!(r.contains_exclusive(4) && !r.contains_exclusive(3));
        assert_eq!(r.with_pos(5), new_text_range(5, 8));
        assert_eq!(r.with_end(5), new_text_range(3, 5));
        assert!(new_text_range(4, 6).contained_by(r) && !r.contained_by(new_text_range(4, 6)));
        assert!(r.overlaps(new_text_range(7, 9)) && !r.overlaps(new_text_range(8, 9)));
        assert!(r.intersects(new_text_range(8, 9)) && !r.intersects(new_text_range(9, 10)));
        assert_eq!(compare_text_ranges(r, new_text_range(3, 9)), -1);
        assert_eq!(compare_text_ranges(r, new_text_range(1, 9)), 2);
        assert_eq!(compare_text_ranges(r, r), 0);
    }
}
