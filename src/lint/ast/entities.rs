//! The named character references of XHTML, which JSX text and attribute strings may contain.

/// Sorted by name.
const ENTITIES: [(&str, u32); 253] = [
    ("AElig", 0x00C6),
    ("Aacute", 0x00C1),
    ("Acirc", 0x00C2),
    ("Agrave", 0x00C0),
    ("Alpha", 0x0391),
    ("Aring", 0x00C5),
    ("Atilde", 0x00C3),
    ("Auml", 0x00C4),
    ("Beta", 0x0392),
    ("Ccedil", 0x00C7),
    ("Chi", 0x03A7),
    ("Dagger", 0x2021),
    ("Delta", 0x0394),
    ("ETH", 0x00D0),
    ("Eacute", 0x00C9),
    ("Ecirc", 0x00CA),
    ("Egrave", 0x00C8),
    ("Epsilon", 0x0395),
    ("Eta", 0x0397),
    ("Euml", 0x00CB),
    ("Gamma", 0x0393),
    ("Iacute", 0x00CD),
    ("Icirc", 0x00CE),
    ("Igrave", 0x00CC),
    ("Iota", 0x0399),
    ("Iuml", 0x00CF),
    ("Kappa", 0x039A),
    ("Lambda", 0x039B),
    ("Mu", 0x039C),
    ("Ntilde", 0x00D1),
    ("Nu", 0x039D),
    ("OElig", 0x0152),
    ("Oacute", 0x00D3),
    ("Ocirc", 0x00D4),
    ("Ograve", 0x00D2),
    ("Omega", 0x03A9),
    ("Omicron", 0x039F),
    ("Oslash", 0x00D8),
    ("Otilde", 0x00D5),
    ("Ouml", 0x00D6),
    ("Phi", 0x03A6),
    ("Pi", 0x03A0),
    ("Prime", 0x2033),
    ("Psi", 0x03A8),
    ("Rho", 0x03A1),
    ("Scaron", 0x0160),
    ("Sigma", 0x03A3),
    ("THORN", 0x00DE),
    ("Tau", 0x03A4),
    ("Theta", 0x0398),
    ("Uacute", 0x00DA),
    ("Ucirc", 0x00DB),
    ("Ugrave", 0x00D9),
    ("Upsilon", 0x03A5),
    ("Uuml", 0x00DC),
    ("Xi", 0x039E),
    ("Yacute", 0x00DD),
    ("Yuml", 0x0178),
    ("Zeta", 0x0396),
    ("aacute", 0x00E1),
    ("acirc", 0x00E2),
    ("acute", 0x00B4),
    ("aelig", 0x00E6),
    ("agrave", 0x00E0),
    ("alefsym", 0x2135),
    ("alpha", 0x03B1),
    ("amp", 0x0026),
    ("and", 0x2227),
    ("ang", 0x2220),
    ("apos", 0x0027),
    ("aring", 0x00E5),
    ("asymp", 0x2248),
    ("atilde", 0x00E3),
    ("auml", 0x00E4),
    ("bdquo", 0x201E),
    ("beta", 0x03B2),
    ("brvbar", 0x00A6),
    ("bull", 0x2022),
    ("cap", 0x2229),
    ("ccedil", 0x00E7),
    ("cedil", 0x00B8),
    ("cent", 0x00A2),
    ("chi", 0x03C7),
    ("circ", 0x02C6),
    ("clubs", 0x2663),
    ("cong", 0x2245),
    ("copy", 0x00A9),
    ("crarr", 0x21B5),
    ("cup", 0x222A),
    ("curren", 0x00A4),
    ("dArr", 0x21D3),
    ("dagger", 0x2020),
    ("darr", 0x2193),
    ("deg", 0x00B0),
    ("delta", 0x03B4),
    ("diams", 0x2666),
    ("divide", 0x00F7),
    ("eacute", 0x00E9),
    ("ecirc", 0x00EA),
    ("egrave", 0x00E8),
    ("empty", 0x2205),
    ("emsp", 0x2003),
    ("ensp", 0x2002),
    ("epsilon", 0x03B5),
    ("equiv", 0x2261),
    ("eta", 0x03B7),
    ("eth", 0x00F0),
    ("euml", 0x00EB),
    ("euro", 0x20AC),
    ("exist", 0x2203),
    ("fnof", 0x0192),
    ("forall", 0x2200),
    ("frac12", 0x00BD),
    ("frac14", 0x00BC),
    ("frac34", 0x00BE),
    ("frasl", 0x2044),
    ("gamma", 0x03B3),
    ("ge", 0x2265),
    ("gt", 0x003E),
    ("hArr", 0x21D4),
    ("harr", 0x2194),
    ("hearts", 0x2665),
    ("hellip", 0x2026),
    ("iacute", 0x00ED),
    ("icirc", 0x00EE),
    ("iexcl", 0x00A1),
    ("igrave", 0x00EC),
    ("image", 0x2111),
    ("infin", 0x221E),
    ("int", 0x222B),
    ("iota", 0x03B9),
    ("iquest", 0x00BF),
    ("isin", 0x2208),
    ("iuml", 0x00EF),
    ("kappa", 0x03BA),
    ("lArr", 0x21D0),
    ("lambda", 0x03BB),
    ("lang", 0x2329),
    ("laquo", 0x00AB),
    ("larr", 0x2190),
    ("lceil", 0x2308),
    ("ldquo", 0x201C),
    ("le", 0x2264),
    ("lfloor", 0x230A),
    ("lowast", 0x2217),
    ("loz", 0x25CA),
    ("lrm", 0x200E),
    ("lsaquo", 0x2039),
    ("lsquo", 0x2018),
    ("lt", 0x003C),
    ("macr", 0x00AF),
    ("mdash", 0x2014),
    ("micro", 0x00B5),
    ("middot", 0x00B7),
    ("minus", 0x2212),
    ("mu", 0x03BC),
    ("nabla", 0x2207),
    ("nbsp", 0x00A0),
    ("ndash", 0x2013),
    ("ne", 0x2260),
    ("ni", 0x220B),
    ("not", 0x00AC),
    ("notin", 0x2209),
    ("nsub", 0x2284),
    ("ntilde", 0x00F1),
    ("nu", 0x03BD),
    ("oacute", 0x00F3),
    ("ocirc", 0x00F4),
    ("oelig", 0x0153),
    ("ograve", 0x00F2),
    ("oline", 0x203E),
    ("omega", 0x03C9),
    ("omicron", 0x03BF),
    ("oplus", 0x2295),
    ("or", 0x2228),
    ("ordf", 0x00AA),
    ("ordm", 0x00BA),
    ("oslash", 0x00F8),
    ("otilde", 0x00F5),
    ("otimes", 0x2297),
    ("ouml", 0x00F6),
    ("para", 0x00B6),
    ("part", 0x2202),
    ("permil", 0x2030),
    ("perp", 0x22A5),
    ("phi", 0x03C6),
    ("pi", 0x03C0),
    ("piv", 0x03D6),
    ("plusmn", 0x00B1),
    ("pound", 0x00A3),
    ("prime", 0x2032),
    ("prod", 0x220F),
    ("prop", 0x221D),
    ("psi", 0x03C8),
    ("quot", 0x0022),
    ("rArr", 0x21D2),
    ("radic", 0x221A),
    ("rang", 0x232A),
    ("raquo", 0x00BB),
    ("rarr", 0x2192),
    ("rceil", 0x2309),
    ("rdquo", 0x201D),
    ("real", 0x211C),
    ("reg", 0x00AE),
    ("rfloor", 0x230B),
    ("rho", 0x03C1),
    ("rlm", 0x200F),
    ("rsaquo", 0x203A),
    ("rsquo", 0x2019),
    ("sbquo", 0x201A),
    ("scaron", 0x0161),
    ("sdot", 0x22C5),
    ("sect", 0x00A7),
    ("shy", 0x00AD),
    ("sigma", 0x03C3),
    ("sigmaf", 0x03C2),
    ("sim", 0x223C),
    ("spades", 0x2660),
    ("sub", 0x2282),
    ("sube", 0x2286),
    ("sum", 0x2211),
    ("sup", 0x2283),
    ("sup1", 0x00B9),
    ("sup2", 0x00B2),
    ("sup3", 0x00B3),
    ("supe", 0x2287),
    ("szlig", 0x00DF),
    ("tau", 0x03C4),
    ("there4", 0x2234),
    ("theta", 0x03B8),
    ("thetasym", 0x03D1),
    ("thinsp", 0x2009),
    ("thorn", 0x00FE),
    ("tilde", 0x02DC),
    ("times", 0x00D7),
    ("trade", 0x2122),
    ("uArr", 0x21D1),
    ("uacute", 0x00FA),
    ("uarr", 0x2191),
    ("ucirc", 0x00FB),
    ("ugrave", 0x00F9),
    ("uml", 0x00A8),
    ("upsih", 0x03D2),
    ("upsilon", 0x03C5),
    ("uuml", 0x00FC),
    ("weierp", 0x2118),
    ("xi", 0x03BE),
    ("yacute", 0x00FD),
    ("yen", 0x00A5),
    ("yuml", 0x00FF),
    ("zeta", 0x03B6),
    ("zwj", 0x200D),
    ("zwnj", 0x200C),
];

/// typescript-estree's `unescapeStringLiteralText`: `text` with `&name;`, `&#10;` and `&#xA;`
/// replaced by what they stand for. What is not a known reference stays as it is.
pub(crate) fn unescape(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings::index_of_char_usize;
    let Some(first) = index_of_char_usize(text, b'&') else {
        return text.into();
    };
    let mut out = Vec::with_capacity(text.len());
    out.extend_from_slice(&text[..first]);
    let mut rest = &text[first..];
    loop {
        // `rest` starts with `&`.
        let decoded = index_of_char_usize(rest, b';').and_then(|end| Some((code_point(&rest[1..end])?, end)));
        let taken = match decoded {
            Some((c, end)) => {
                push_code_point(&mut out, c);
                end + 1
            }
            None => {
                out.push(b'&');
                1
            }
        };
        rest = &rest[taken..];
        let Some(next) = index_of_char_usize(rest, b'&') else {
            out.extend_from_slice(rest);
            return out.into();
        };
        out.extend_from_slice(&rest[..next]);
        rest = &rest[next..];
    }
}

/// What `&item;` stands for.
fn code_point(item: &[u8]) -> Option<u32> {
    let digits = |digits: &[u8], radix: u32| {
        let is_digit = |b: &u8| (*b as char).is_digit(radix);
        if digits.is_empty() || !digits.iter().all(is_digit) {
            return None;
        }
        let mut value = 0u32;
        for digit in digits {
            value = value.saturating_mul(radix).saturating_add((*digit as char).to_digit(radix)?);
        }
        (value <= 0x10FFFF).then_some(value)
    };
    match item {
        [b'#', b'x', hex @ ..] => digits(hex, 16),
        [b'#', decimal @ ..] => digits(decimal, 10),
        _ => {
            let at = ENTITIES.binary_search_by(|it| it.0.as_bytes().cmp(item)).ok()?;
            Some(ENTITIES[at].1)
        }
    }
}

/// Appends `c` as UTF-8, a surrogate as the three bytes that WTF-8 has for it.
fn push_code_point(out: &mut Vec<u8>, c: u32) {
    match char::from_u32(c) {
        Some(c) => out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
        None => out.extend_from_slice(&[
            0xE0 | (c >> 12) as u8,
            0x80 | ((c >> 6) & 0x3F) as u8,
            0x80 | (c & 0x3F) as u8,
        ]),
    }
}
