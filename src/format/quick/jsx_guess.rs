use crate::{Bytes, Quick, Words};

impl Quick {
    /// The length of the line terminator that ends right before p, or 0.
    pub(crate) fn terminator_before(&self, p: i32, start: i32) -> i32 {
        if p <= start {
            return 0;
        }
        let c = self.t.at(p - 1);
        if c == 10 || c == 13 {
            return 1;
        }
        if (c == 0xa8 || c == 0xa9)
            && p - 3 >= start
            && self.t.at(p - 2) == 0x80
            && self.t.at(p - 3) == 0xe2
        {
            return 3;
        }
        return 0;
    }

    pub(crate) fn is_line_start(&self, p: i32, start: i32) -> bool {
        return p == start || self.terminator_before(p, start) != 0;
    }

    /// ^[^/]{2}.*\/> with the "/>" at q
    pub(crate) fn closes_tag_at(&self, q: i32, start: i32) -> bool {
        let mut s = q;
        while !self.is_line_start(s, start) {
            s -= 1;
        }
        // both characters in the line of the "/>"
        if s < q && self.t.at(s) != 47 {
            let c = self.t.at(s);
            if c >= 0xf0 {
                // two units of UTF-16
                return true;
            }
            let second = s
                + (if c < 0x80 {
                    1
                } else {
                    if c < 0xe0 { 2 } else { 3 }
                });
            if second < q && self.t.at(second) != 47 {
                return true;
            }
        }
        let length = self.terminator_before(s, start);
        if length == 0 {
            return false;
        }
        let p1 = s - length;
        // the end of an empty line and the first character of this one
        if self.is_line_start(p1, start) && s < q && self.t.at(s) != 47 {
            return true;
        }
        // a line of one character, or another empty line, and the end of that line
        if p1 == start {
            return false;
        }
        let before = self.terminator_before(p1, start);
        if before != 0 {
            return self.is_line_start(p1 - before, start);
        }
        let mut p2 = p1 - 1;
        while p2 > start && (self.t.at(p2) & 0xc0) == 0x80 {
            p2 -= 1;
        }
        return self.t.at(p2) != 47 && self.t.at(p2) < 0xf0 && self.is_line_start(p2, start);
    }

    pub(crate) fn is_probably_jsx(&mut self, start: i32, end: i32) -> bool {
        let kept = self.t.at(end);
        // indexOf() knows no end
        self.t.put(end, 47);
        let mut found = false;
        let mut p = self.t.index_of(47, start);
        while p < end {
            if p > start && self.t.at(p - 1) == 60 {
                // ^[^"'`]*<\/ : no quote between the start of the line and here
                let mut s = p - 1;
                loop {
                    if self.is_line_start(s, start) {
                        found = true;
                        break;
                    }
                    s -= 1;
                    let c = self.t.at(s);
                    if c == 34 || c == 39 || c == 96 {
                        break;
                    }
                }
                if found {
                    break;
                }
            }
            if p + 1 < end && self.t.at(p + 1) == 62 && self.closes_tag_at(p, start) {
                found = true;
                break;
            }
            p = self.t.index_of(47, p + 1);
        }
        self.t.put(end, kept);
        return found;
    }
}
