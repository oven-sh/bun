//! Priority classes, and the nice values that `os.constants.priority` gives them.

const IDLE: (u32, i32) = (0x0040, 19);

const CLASSES: [(u32, i32); 6] = [
    IDLE,
    (0x4000, 10),
    (0x0020, 0),
    (0x8000, -7),
    (0x0080, -14),
    (0x0100, -20),
];

pub(crate) fn nice_of_class(class: u32) -> i32 {
    let found = CLASSES.into_iter().find(|&(it, _)| it == class);
    found.unwrap_or(IDLE).1
}

/// A value between two classes gets the higher one. `None` outside of -20 to 19.
pub(crate) fn class_of_nice(nice: i32) -> Option<u32> {
    let found = CLASSES.into_iter().find(|&(_, it)| it <= nice);
    found.filter(|_| nice <= IDLE.1).map(|(class, _)| class)
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
            assert_eq!(nice_of_class(class), *range.start());
            for nice in range {
                assert_eq!(class_of_nice(nice), Some(class));
            }
        }
        for nice in [i32::MIN, -21, 20, i32::MAX] {
            assert_eq!(class_of_nice(nice), None);
        }
        assert_eq!(nice_of_class(0x1234), 19);
    }
}
