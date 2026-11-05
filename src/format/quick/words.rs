use crate::{Quick, Words};

#[allow(non_upper_case_globals)]
pub(crate) mod w {
    pub(crate) const None: i32 = 0;
    pub(crate) const Abstract: i32 = 1;
    pub(crate) const Accessor: i32 = 2;
    pub(crate) const Any: i32 = 3;
    pub(crate) const Asserts: i32 = 5;
    pub(crate) const Async: i32 = 6;
    pub(crate) const Bigint: i32 = 7;
    pub(crate) const Boolean: i32 = 8;
    pub(crate) const Declare: i32 = 9;
    pub(crate) const Enum: i32 = 10;
    pub(crate) const Global: i32 = 12;
    pub(crate) const Implements: i32 = 13;
    pub(crate) const Infer: i32 = 14;
    pub(crate) const Interface: i32 = 15;
    pub(crate) const Intrinsic: i32 = 16;
    pub(crate) const Is: i32 = 17;
    pub(crate) const Keyof: i32 = 18;
    pub(crate) const Module: i32 = 19;
    pub(crate) const Namespace: i32 = 20;
    pub(crate) const Never: i32 = 21;
    pub(crate) const Number: i32 = 22;
    pub(crate) const Object: i32 = 23;
    pub(crate) const Out: i32 = 24;
    pub(crate) const Override: i32 = 25;
    pub(crate) const Private: i32 = 26;
    pub(crate) const Protected: i32 = 27;
    pub(crate) const Public: i32 = 28;
    pub(crate) const Readonly: i32 = 29;
    pub(crate) const Require: i32 = 30;
    pub(crate) const Satisfies: i32 = 31;
    pub(crate) const Static: i32 = 33;
    pub(crate) const String: i32 = 34;
    pub(crate) const Symbol: i32 = 35;
    pub(crate) const Type: i32 = 36;
    pub(crate) const Undefined: i32 = 37;
    pub(crate) const Unique: i32 = 38;
    pub(crate) const Unknown: i32 = 39;
    pub(crate) const Bool: i32 = 40;
    pub(crate) const Checks: i32 = 41;
    pub(crate) const Component: i32 = 42;
    pub(crate) const Empty: i32 = 43;
    pub(crate) const Exports: i32 = 44;
    pub(crate) const Hook: i32 = 45;
    pub(crate) const Implies: i32 = 46;
    pub(crate) const Match: i32 = 47;
    pub(crate) const Mixed: i32 = 48;
    pub(crate) const Mixins: i32 = 49;
    pub(crate) const Opaque: i32 = 51;
    pub(crate) const Proto: i32 = 52;
    pub(crate) const Record: i32 = 53;
    pub(crate) const Renders: i32 = 54;
    pub(crate) const Writeonly: i32 = 55;
}
// a perfect hash of the first, the second and the last character and the length
pub(crate) const A: i32 = 1;
pub(crate) const B: i32 = 1;
pub(crate) const C: i32 = 43;
pub(crate) const D: i32 = 10;
pub(crate) const MASK: i32 = 255;
/// length | word << 8
pub(crate) static INFO: [i32; 256] = [
    0, 0, 0, 0, 0, 0, 2311, 0, 6921, 9481, 0, 12802, 9220, 0, 0, 4870, 0, 0, 13062, 0, 7687, 0,
    9734, 0, 0, 0, 0, 0, 0, 10244, 0, 6663, 5129, 0, 0, 0, 4613, 0, 0, 0, 3849, 0, 0, 5381, 6408,
    0, 0, 3589, 0, 0, 0, 3078, 0, 0, 0, 0, 0, 1026, 520, 0, 0, 0, 0, 0, 771, 4354, 0, 0, 0, 5638,
    0, 0, 0, 0, 2564, 0, 8966, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11013, 10502, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 12550, 0, 0, 2819, 0, 0, 0, 0, 1287, 0, 11783, 13831, 0, 8710, 0, 8195, 0, 11271, 0, 0,
    0, 12037, 0, 7432, 0, 0, 0, 6147, 7945, 0, 0, 0, 1798, 0, 0, 0, 0, 0, 5894, 0, 3338, 0, 0, 0,
    264, 0, 2055, 0, 0, 0, 0, 14089, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9991, 0, 0, 0, 1541,
    10761, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 13317, 0, 0, 0, 0, 0, 0, 0, 0, 7174, 0,
    8454, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4105, 0, 12293, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    13574, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11524, 0, 0, 0,
    0, 0, 0, 0,
];
/// where the word stands in T
pub(crate) static TEXT: [i32; 256] = [
    0, 0, 0, 0, 0, 0, 1335, 0, 1445, 1509, 0, 1589, 1505, 0, 0, 1395, 0, 0, 1591, 0, 1468, 0, 1518,
    0, 0, 0, 0, 0, 0, 1531, 0, 1438, 1401, 0, 0, 0, 1390, 0, 0, 0, 1370, 0, 0, 1410, 1430, 0, 0,
    1365, 0, 0, 0, 1349, 0, 0, 0, 0, 0, 1308, 1297, 0, 0, 0, 0, 0, 1305, 1388, 0, 0, 0, 1415, 0, 0,
    0, 0, 1342, 0, 1499, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1550, 1535, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1583, 0, 0, 1346, 0, 0, 0, 0, 1310, 0, 1566, 1608, 0, 1493, 0, 1484, 0, 1555, 0, 0, 0, 1573, 0,
    1460, 0, 0, 0, 1427, 1475, 0, 0, 0, 1322, 0, 0, 0, 0, 0, 1421, 0, 1355, 0, 0, 0, 1289, 0, 1328,
    0, 0, 0, 0, 1615, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1524, 0, 0, 0, 1317, 1541, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1597, 0, 0, 0, 0, 0, 0, 0, 0, 1454, 0, 1487, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1379, 0, 1578, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1602, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1562, 0, 0, 0, 0, 0, 0, 0,
];
// by first character: bit n is set if a word of n characters starts with it
pub(crate) static LENGTHS: [i32; 128] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 428, 208, 576, 128, 176, 0, 72, 16, 1700, 0, 32, 0, 96, 608, 332, 736, 0, 448, 584, 16, 704,
    0, 512, 0, 0, 0, 0, 0, 0, 0, 0,
];
impl Quick {
    /// Which word is T[start, end)?
    pub(crate) fn word_at(&self, start: i32, end: i32) -> i32 {
        let length = end - start;
        if length < 2 || length > 10 {
            return w::None;
        }
        if (LENGTHS
            .at(self.t.at(start) & 127)
            .wrapping_shr(length as u32)
            & 1)
            == 0
        {
            return w::None;
        }
        let h =
            (self.t.at(start) * A + self.t.at(start + 1) * B + self.t.at(end - 1) * C + length * D)
                & MASK;
        let info = INFO.at(h);
        if (info & 255) != length {
            return w::None;
        }
        let w = TEXT.at(h);
        let mut i: i32 = 0;
        while i < length {
            if self.t.at(start + i) != self.t.at(w + i) {
                return w::None;
            }
            i += 1;
        }
        return info >> 8;
    }
}
