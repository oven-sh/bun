// internal/core/pattern.go
use crate::stringutil::util::strings;

#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct Pattern {
    pub text: Vec<u8>,
    // -1 for exact match
    pub star_index: isize,
}

pub fn try_parse_pattern(pattern: &[u8]) -> Pattern {
    let star_index = strings::index(pattern, b"*");
    if star_index == -1 || !strings::contains(strings::slice_from(pattern, star_index + 1), b"*") {
        return Pattern {
            text: pattern.to_vec(),
            star_index,
        };
    }
    Pattern::default()
}

impl Pattern {
    pub fn is_valid(&self) -> bool {
        self.star_index == -1 || self.star_index < self.text.len() as isize
    }

    // False for a pattern that is not valid, where upstream panics.
    pub fn matches(&self, candidate: &[u8]) -> bool {
        if self.star_index == -1 {
            return self.text == candidate;
        }
        if !self.is_valid() {
            return false;
        }
        candidate.len() as isize >= self.text.len() as isize - 1
            && candidate.starts_with(strings::slice_to(&self.text, self.star_index))
            && candidate.ends_with(strings::slice_from(&self.text, self.star_index + 1))
    }

    // Err is upstream's panic with its message.
    pub fn matched_text<'a>(&self, candidate: &'a [u8]) -> Result<&'a [u8], &'static str> {
        if !self.matches(candidate) {
            return Err("candidate does not match pattern");
        }
        if self.star_index == -1 {
            return Ok(b"");
        }
        let end = candidate.len() as isize - self.text.len() as isize + self.star_index + 1;
        Ok(strings::slice(candidate, self.star_index, end))
    }
}

// The value whose pattern matches the candidate with the longest prefix before the star, an exact match first: None is upstream's zero value.
pub fn find_best_pattern_match<'a, T>(
    values: &'a [T],
    get_pattern: impl Fn(&'a T) -> &'a Pattern,
    candidate: &[u8],
) -> Option<&'a T> {
    let mut best_pattern: Option<&'a T> = None;
    let mut longest_match_prefix_length: isize = -1;
    for value in values {
        let pattern = get_pattern(value);
        if (pattern.star_index == -1 || pattern.star_index > longest_match_prefix_length)
            && pattern.matches(candidate)
        {
            best_pattern = Some(value);
            longest_match_prefix_length = pattern.star_index;
        }
    }
    best_pattern
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stringutil::util::strings::split;

    fn unhex(s: &[u8]) -> Vec<u8> {
        let digit = |b: u8| (b as char).to_digit(16).unwrap() as u8;
        s.as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (digit(pair[0]) << 4) | digit(pair[1]))
            .collect()
    }

    // Replays upstream's Go code: a pattern, a candidate, and the star index, IsValid, Matches and MatchedText (PANIC for its panic).
    #[test]
    fn matches_upstream_vectors() {
        let text = include_bytes!("testdata/pattern.tsv");
        let mut checked = 0;
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let (pattern, candidate) = (try_parse_pattern(&unhex(f[0])), unhex(f[1]));
            let matched = match pattern.matched_text(&candidate) {
                Ok(text) => text
                    .iter()
                    .fold(String::from("="), |hex, b| hex + &format!("{b:02x}")),
                Err(_) => String::from("PANIC"),
            };
            let got = format!(
                "{} {} {} {}",
                pattern.star_index,
                u8::from(pattern.is_valid()),
                u8::from(pattern.is_valid() && pattern.matches(&candidate)),
                matched
            );
            assert_eq!(
                got.as_bytes(),
                f[2],
                "{}",
                std::str::from_utf8(line).unwrap()
            );
            checked += 1;
        }
        assert_eq!(checked, 304);
    }

    #[test]
    fn best_match_prefers_exact_then_longest_prefix() {
        let patterns: Vec<Pattern> = [
            &b"*"[..],
            b"foo/*",
            b"foo/bar/*",
            b"foo/bar/baz",
            b"*.ts",
            b"a*b*c",
        ]
        .iter()
        .map(|text| try_parse_pattern(text))
        .collect();
        let best = |candidate: &[u8]| {
            find_best_pattern_match(&patterns, |p| p, candidate).map(|p| p.text.as_slice())
        };
        assert_eq!(best(b"foo/bar/baz"), Some(&b"foo/bar/baz"[..]));
        assert_eq!(best(b"foo/bar/qux"), Some(&b"foo/bar/*"[..]));
        assert_eq!(best(b"foo/x"), Some(&b"foo/*"[..]));
        assert_eq!(best(b"x.ts"), Some(&b"*"[..]));
        assert_eq!(
            find_best_pattern_match(&patterns[1..4], |p| p, b"zzz"),
            None
        );
        assert_eq!(patterns[5], Pattern::default());
        assert!(!patterns[5].is_valid());
    }
}
