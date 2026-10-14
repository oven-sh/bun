//! The features that can be excluded.
//!
//! One that is code has markers in the source (`bun_core::feature::present`) and needs no more than its name here. One
//! that is a property has ROWS: entries of the tables that the properties of an object are made from. Without the
//! row the property does not exist, and whatever only the row referred to goes with it.

// `pub` is for `bun_core`, whose file it is.
#[allow(unreachable_pub)]
#[path = "../../bun_core/feature/ids.rs"]
mod ids;

pub(super) struct Feature {
    pub(super) name: &'static str,
    /// What its markers hold, if it has any. Any number no other feature has, else.
    pub(super) id: u32,
    pub(super) rows: &'static [Row],
}

pub(super) struct Row {
    /// The symbol of the table, as a [`matches`] pattern: in the Itanium mangling, and in Microsoft's.
    pub(super) table: &'static str,
    pub(super) msvc_table: &'static str,
    pub(super) size: u64,
    pub(super) select: Select,
}

pub(super) enum Select {
    /// The `JSC::HashTableValue` of the property with this name.
    Key(&'static str),
    /// The rows that point at a symbol matching one of these patterns.
    PointsAt {
        itanium: &'static str,
        msvc: &'static str,
    },
}

const fn bun_object(key: &'static str) -> Row {
    Row {
        table: "3Bun*bunObjectTableValues",
        msvc_table: "^?bunObjectTableValues@Bun@@",
        size: 40,
        select: Select::Key(key),
    }
}

pub(super) const FEATURES: &[Feature] = &[
    Feature {
        name: "check",
        id: ids::CHECK,
        rows: &[],
    },
    Feature {
        name: "lint",
        id: ids::LINT,
        rows: &[],
    },
    Feature {
        name: "fmt",
        id: ids::FMT,
        rows: &[],
    },
    Feature {
        name: "Bun.password",
        id: 100,
        rows: &[bun_object("password")],
    },
    Feature {
        name: "Bun.Transpiler",
        id: 101,
        rows: &[
            bun_object("Transpiler"),
            Row {
                table: "generatedLazyClassInits",
                msvc_table: "generatedLazyClassInits",
                size: 24,
                select: Select::PointsAt {
                    itanium: "7WebCore12JSTranspiler#create",
                    msvc: "^?create*@JSTranspiler@WebCore@@",
                },
            },
        ],
    },
];

const _: () = {
    let mut i = 0;
    while i < FEATURES.len() {
        let mut j = 0;
        while j < i {
            assert!(FEATURES[i].id != FEATURES[j].id, "two features have one id");
            j += 1;
        }
        i += 1;
    }
};

/// Whether `pattern` occurs in `name`. `^` at the start: at the start of it. `*`: anything. `#`: one or more digits.
pub(super) fn matches(pattern: &str, name: &[u8]) -> bool {
    fn here(pattern: &[u8], name: &[u8]) -> bool {
        match pattern.split_first() {
            None => true,
            Some((b'*', rest)) => (0..=name.len()).any(|skip| here(rest, &name[skip..])),
            Some((b'#', rest)) => {
                let digits = name.iter().take_while(|b| b.is_ascii_digit()).count();
                (1..=digits).any(|taken| here(rest, &name[taken..]))
            }
            Some((literal, rest)) => name.first() == Some(literal) && here(rest, &name[1..]),
        }
    }
    match pattern.strip_prefix('^') {
        Some(anchored) => here(anchored.as_bytes(), name),
        None => (0..=name.len()).any(|skip| here(pattern.as_bytes(), &name[skip..])),
    }
}
