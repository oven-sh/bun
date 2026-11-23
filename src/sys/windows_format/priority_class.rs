//! Mapping between process priority classes and the nice values of `os.constants.priority`.

const IDLE_PRIORITY_CLASS: u32 = 0x0040;
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x4000;
const NORMAL_PRIORITY_CLASS: u32 = 0x0020;
const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x8000;
const HIGH_PRIORITY_CLASS: u32 = 0x0080;
const REALTIME_PRIORITY_CLASS: u32 = 0x0100;

const MAX_NICE: i32 = 19;

/// From the lowest priority to the highest.
const NICE_BY_CLASS: [(u32, i32); 6] = [
    (IDLE_PRIORITY_CLASS, MAX_NICE),
    (BELOW_NORMAL_PRIORITY_CLASS, 10),
    (NORMAL_PRIORITY_CLASS, 0),
    (ABOVE_NORMAL_PRIORITY_CLASS, -7),
    (HIGH_PRIORITY_CLASS, -14),
    (REALTIME_PRIORITY_CLASS, -20),
];

/// An unknown class is treated as `IDLE_PRIORITY_CLASS`.
pub(crate) fn class_to_nice(class: u32) -> i32 {
    let entry = NICE_BY_CLASS
        .into_iter()
        .find(|&(entry_class, _)| entry_class == class);
    entry.map_or(MAX_NICE, |(_, nice)| nice)
}

/// A value between two classes maps to the higher-priority one. `None` outside `-20..=19`.
pub(crate) fn nice_to_class(nice: i32) -> Option<u32> {
    let entry = NICE_BY_CLASS
        .into_iter()
        .find(|&(_, entry_nice)| entry_nice <= nice);
    entry.filter(|_| nice <= MAX_NICE).map(|(class, _)| class)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_nice_value() {
        for (range, class) in [
            (-20..=-15, 0x100),
            (-14..=-8, 0x80),
            (-7..=-1, 0x8000),
            (0..=9, 0x20),
            (10..=18, 0x4000),
            (19..=19, 0x40),
        ] {
            assert_eq!(class_to_nice(class), *range.start());
            for nice in range {
                assert_eq!(nice_to_class(nice), Some(class));
            }
        }
        for nice in [i32::MIN, -21, 20, i32::MAX] {
            assert_eq!(nice_to_class(nice), None);
        }
        assert_eq!(class_to_nice(0x1234), 19);
    }
}
