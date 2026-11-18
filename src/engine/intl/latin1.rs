//! The letters from U+00C0 to U+00FF that are an ASCII letter with an accent.

const FIRST: u8 = 0xc0;
const BASES: &[u8; 64] = b"AAAAAA CEEEEIIII NOOOOO OUUUUY  aaaaaa ceeeeiiii nooooo ouuuuy y";
const ACCENTS: &[u8; 64] = b"`'^~:o ,`'^:`'^: ~`'^~: /`'^:'  `'^~:o ,`'^:`'^: ~`'^~: /`'^:' :";

/// In the order of the root collation.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Accent {
    Acute,
    Grave,
    Circumflex,
    Ring,
    Diaeresis,
    Tilde,
    Stroke,
    Cedilla,
}

pub(crate) const fn split_accent(character: u8) -> Option<(u8, Accent)> {
    let Some(index) = character.checked_sub(FIRST) else {
        return None;
    };
    let accent = match ACCENTS[index as usize] {
        b'\'' => Accent::Acute,
        b'`' => Accent::Grave,
        b'^' => Accent::Circumflex,
        b'o' => Accent::Ring,
        b':' => Accent::Diaeresis,
        b'~' => Accent::Tilde,
        b'/' => Accent::Stroke,
        b',' => Accent::Cedilla,
        _ => return None,
    };
    Some((BASES[index as usize], accent))
}
