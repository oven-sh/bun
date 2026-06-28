//! Byte-exact port of git's `wildmatch.c` (`dowild`), rewritten as an
//! iterative matcher with bounded backtracking instead of recursion.
//!
//! Upstream: git.git `wildmatch.c` ("Do shell-style pattern matching for ?,
//! \, [], and * characters", Rich Salz / Wayne Davison). Every rule below
//! cites the corresponding upstream behavior.

bitflags::bitflags! {
    /// Subset of git's `WM_*` flags that gitignore matching uses
    /// (`wildmatch.h`: `WM_CASEFOLD 1`, `WM_PATHNAME 2`).
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct WildmatchFlags: u8 {
        const CASEFOLD = 1 << 0;
        /// `*` and `?` do not match `/`; `**` (only as a whole path
        /// component) does.
        const PATHNAME = 1 << 1;
    }
}

/// git `wildmatch(pattern, text, flags) == WM_MATCH`.
///
/// `text` is matched in full (this is not a search). Both inputs are raw
/// bytes; a malformed pattern (e.g. an unterminated `[`) never matches,
/// mirroring `WM_ABORT_ALL` in wildmatch.c.
pub fn wildmatch(pattern: &[u8], text: &[u8], flags: WildmatchFlags) -> bool {
    dowild(pattern, text, flags) == Wild::Match
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Wild {
    Match,
    NoMatch,
    /// wildmatch.c `WM_ABORT_ALL`: the pattern itself is malformed, so no
    /// backtracking alternative can ever succeed.
    Abort,
}

/// Backtrack state for the most recent slash-crossing star (a whole-component
/// `**` under PATHNAME, or any `*` without PATHNAME).
///
/// Candidate resume points, in order: the pending `<bp + 1, bt>` "matches zero
/// directories" alternative (wildmatch.c's `dowild(p + 1, text, flags)` probe
/// for `**/`), then `<bp, bt>`, `<bp, bt + 1>`, ... — i.e. the star absorbs
/// one more text byte each time.
#[derive(Clone, Copy)]
struct DoubleStar {
    bp: usize,
    bt: usize,
    zero_pending: bool,
}

/// One-slot backtrack states are sufficient: stars never need to be resumed
/// once a strictly later star of equal or greater power has been passed
/// (the later star's candidate set is a superset). A `*` after a `**` is
/// weaker, hence the second, separate `**` slot.
fn dowild(pat: &[u8], text: &[u8], flags: WildmatchFlags) -> Wild {
    let pathname = flags.contains(WildmatchFlags::PATHNAME);
    let fold = flags.contains(WildmatchFlags::CASEFOLD);
    let mut p = 0usize;
    let mut t = 0usize;
    // Most recent non-slash-crossing `*`: (pattern index after it, text index
    // of the next byte it would absorb).
    let mut star: Option<(usize, usize)> = None;
    let mut dstar: Option<DoubleStar> = None;
    loop {
        if p == pat.len() {
            // wildmatch.c end of dowild: `return *text ? WM_NOMATCH : WM_MATCH`.
            if t == text.len() {
                return Wild::Match;
            }
        } else if pat[p] == b'*' {
            let mut q = p + 1;
            while q < pat.len() && pat[q] == b'*' {
                q += 1;
            }
            let (match_slash, zero_dir) = star_kind(pat, p, q, pathname);
            if q == pat.len() {
                // wildmatch.c: trailing `**` matches everything; a trailing
                // `*` only matches if the rest of the text has no `/`.
                if match_slash || memchr::memchr(b'/', &text[t..]).is_none() {
                    return Wild::Match;
                }
                // WM_ABORT_TO_STARSTAR: fall through to the enclosing `**`.
            } else if match_slash {
                star = None;
                dstar = Some(DoubleStar {
                    bp: q,
                    bt: t,
                    zero_pending: zero_dir,
                });
                p = if zero_dir { q + 1 } else { q };
                continue;
            } else {
                star = Some((q, t));
                p = q;
                continue;
            }
        } else if t < text.len() {
            let tc_raw = text[t];
            let tc = fold_byte(tc_raw, fold);
            let pc = pat[p];
            let mut next_p = p + 1;
            let ok = match pc {
                b'?' => !(pathname && tc_raw == b'/'),
                b'[' => match class_match(pat, p, tc, fold) {
                    ClassMatch::Matched(after) => {
                        next_p = after;
                        // wildmatch.c: `(flags & WM_PATHNAME) && t_ch == '/'`
                        // forces WM_NOMATCH even when the class matched.
                        !(pathname && tc_raw == b'/')
                    }
                    ClassMatch::NotMatched => false,
                    ClassMatch::Malformed => return Wild::Abort,
                },
                // wildmatch.c `case '\\'`: literal match with the next byte.
                // The escaped byte is deliberately NOT case-folded (only
                // `t_ch` was folded by the time the comparison runs).
                b'\\' => {
                    next_p = p + 2;
                    p + 1 < pat.len() && pat[p + 1] == tc
                }
                _ => fold_byte(pc, fold) == tc,
            };
            if ok {
                p = next_p;
                t += 1;
                continue;
            }
        }
        // Mismatch (or input exhausted): backtrack.
        if let Some((bp, bt)) = star {
            if bt < text.len() && text[bt] != b'/' {
                star = Some((bp, bt + 1));
                p = bp;
                t = bt + 1;
                continue;
            }
            // The `*` cannot absorb a `/` (or there is no text left):
            // wildmatch.c's WM_ABORT_TO_STARSTAR.
            star = None;
        }
        if let Some(ds) = &mut dstar {
            if ds.zero_pending {
                ds.zero_pending = false;
                p = ds.bp;
                t = ds.bt;
                continue;
            }
            if ds.bt < text.len() {
                ds.bt += 1;
                p = ds.bp;
                t = ds.bt;
                continue;
            }
        }
        return Wild::NoMatch;
    }
}

/// Classifies a star run `pat[p..q]` per wildmatch.c `case '*'`:
/// returns `(match_slash, zero_dir)`.
///
/// A multi-star run is slash-crossing under PATHNAME only when it spans a
/// whole path component: preceded by start-of-pattern or `/` and followed by
/// end-of-pattern, `/`, or `\/`. `zero_dir` is the extra `**/` alternative
/// ("matches zero or more directories"), tried only for a literal following `/`.
fn star_kind(pat: &[u8], p: usize, q: usize, pathname: bool) -> (bool, bool) {
    if !pathname {
        return (true, false);
    }
    if q - p > 1 {
        let prev_ok = p == 0 || pat[p - 1] == b'/';
        let next_ok = q == pat.len()
            || pat[q] == b'/'
            || (pat[q] == b'\\' && q + 1 < pat.len() && pat[q + 1] == b'/');
        if prev_ok && next_ok {
            return (true, q < pat.len() && pat[q] == b'/');
        }
    }
    (false, false)
}

enum ClassMatch {
    /// The class matched; payload = pattern index just past the closing `]`.
    Matched(usize),
    NotMatched,
    Malformed,
}

/// Port of wildmatch.c `case '['`. `open` is the index of the `[`; `t_ch` has
/// already been case-folded by the caller (as in upstream).
fn class_match(pat: &[u8], open: usize, t_ch: u8, fold: bool) -> ClassMatch {
    let n = pat.len();
    let mut p = open + 1;
    if p >= n {
        return ClassMatch::Malformed;
    }
    // wildmatch.c NEGATE_CLASS '!' / NEGATE_CLASS2 '^'.
    let negated = pat[p] == b'!' || pat[p] == b'^';
    if negated {
        p += 1;
        if p >= n {
            return ClassMatch::Malformed;
        }
    }
    // do { ... } while ((p_ch = *++p) != ']'): a `]` as the first body byte is
    // a literal member, and an unterminated class is WM_ABORT_ALL.
    let mut prev_ch = 0u8;
    let mut matched = false;
    let mut p_ch = pat[p];
    loop {
        if p_ch == b'\\' {
            p += 1;
            if p >= n {
                return ClassMatch::Malformed;
            }
            p_ch = pat[p];
            if t_ch == p_ch {
                matched = true;
            }
        } else if p_ch == b'-' && prev_ch != 0 && p + 1 < n && pat[p + 1] != b']' {
            p += 1;
            p_ch = pat[p];
            if p_ch == b'\\' {
                p += 1;
                if p >= n {
                    return ClassMatch::Malformed;
                }
                p_ch = pat[p];
            }
            if t_ch <= p_ch && t_ch >= prev_ch {
                matched = true;
            } else if fold && t_ch.is_ascii_lowercase() {
                // wildmatch.c: ranges also try the upper-cased text byte
                // under WM_CASEFOLD (t_ch arrives lower-cased).
                let up = t_ch.to_ascii_uppercase();
                if up <= p_ch && up >= prev_ch {
                    matched = true;
                }
            }
            p_ch = 0;
        } else if p_ch == b'[' && p + 1 < n && pat[p + 1] == b':' {
            let s = p + 2;
            let mut q = s;
            while q < n && pat[q] != b']' {
                q += 1;
            }
            if q >= n {
                return ClassMatch::Malformed;
            }
            if q == s || pat[q - 1] != b':' {
                // wildmatch.c: "Didn't find ":]", so treat like a normal set."
                p = s - 2;
                p_ch = b'[';
                if t_ch == p_ch {
                    matched = true;
                }
            } else {
                if !posix_class_match(&pat[s..q - 1], t_ch, fold, &mut matched) {
                    // wildmatch.c: malformed [:class:] string => WM_ABORT_ALL.
                    return ClassMatch::Malformed;
                }
                p = q;
                p_ch = 0;
            }
        } else if t_ch == p_ch {
            matched = true;
        }
        prev_ch = p_ch;
        p += 1;
        if p >= n {
            return ClassMatch::Malformed;
        }
        p_ch = pat[p];
        if p_ch == b']' {
            break;
        }
    }
    if matched != negated {
        ClassMatch::Matched(p + 1)
    } else {
        ClassMatch::NotMatched
    }
}

/// The POSIX classes wildmatch.c supports, with git's locale-independent
/// ASCII semantics (git.git `ctype.c` `sane_ctype[]`). Notably git's
/// `[[:space:]]` is exactly {SP, TAB, LF, CR} (no VT/FF), `[[:cntrl:]]` is
/// 0x00..=0x1F plus 0x7F, and every class is false for bytes >= 0x80.
/// Returns false if `name` is not a recognized class.
fn posix_class_match(name: &[u8], c: u8, fold: bool, matched: &mut bool) -> bool {
    let hit = match name {
        b"alnum" => c.is_ascii_alphanumeric(),
        b"alpha" => c.is_ascii_alphabetic(),
        b"blank" => c == b' ' || c == b'\t',
        b"cntrl" => c < 0x20 || c == 0x7f,
        b"digit" => c.is_ascii_digit(),
        b"graph" => (0x21..=0x7e).contains(&c),
        b"lower" => c.is_ascii_lowercase(),
        b"print" => (0x20..=0x7e).contains(&c),
        b"punct" => (0x21..=0x7e).contains(&c) && !c.is_ascii_alphanumeric(),
        b"space" => matches!(c, b' ' | b'\t' | b'\n' | b'\r'),
        // wildmatch.c: under WM_CASEFOLD `[[:upper:]]` also accepts lowercase
        // (the text byte was already folded to lowercase).
        b"upper" => c.is_ascii_uppercase() || (fold && c.is_ascii_lowercase()),
        b"xdigit" => c.is_ascii_hexdigit(),
        _ => return false,
    };
    if hit {
        *matched = true;
    }
    true
}

#[inline]
fn fold_byte(c: u8, fold: bool) -> u8 {
    if fold { c.to_ascii_lowercase() } else { c }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: WildmatchFlags = WildmatchFlags::empty();
    const PN: WildmatchFlags = WildmatchFlags::PATHNAME;

    #[test]
    fn zero_or_more_directories() {
        assert!(wildmatch(b"foo/**/bar", b"foo/bar", PN));
        assert!(wildmatch(b"foo/**/bar", b"foo/a/bar", PN));
        assert!(wildmatch(b"foo/**/bar", b"foo/a/b/c/bar", PN));
        assert!(!wildmatch(b"foo/**/bar", b"foo/barx", PN));
        assert!(!wildmatch(b"foo/**/bar", b"xfoo/bar", PN));
    }

    #[test]
    fn double_star_then_single_star_needs_two_backtrack_slots() {
        // A later `*` is weaker than an earlier `**`, so exhausting the `*`
        // must fall back to extending the `**` (WM_ABORT_TO_STARSTAR).
        assert!(wildmatch(b"**/ab*c", b"ab/abxc", PN));
        assert!(wildmatch(b"**/a*b", b"a/aXb", PN));
        assert!(!wildmatch(b"**/a*b", b"a/aXbz", PN));
        assert!(wildmatch(b"**/*X*/**/*i", b"ab/cXd/efXg/hi", PN));
    }

    #[test]
    fn escaped_slash_after_double_star_is_a_component_boundary() {
        // wildmatch.c accepts `**\/x` as a slash-crossing star (the byte
        // after the run is `\` followed by `/`), without the zero-directory
        // alternative.
        assert!(wildmatch(b"a/**\\/b", b"a/x/b", PN));
        assert!(wildmatch(b"a/**\\/b", b"a/x/y/b", PN));
        assert!(!wildmatch(b"a/**\\/b", b"a/b", PN));
    }

    #[test]
    fn casefold_applies_to_literals_and_classes_not_escapes() {
        let icase = WildmatchFlags::CASEFOLD;
        assert!(wildmatch(b"FOO", b"foo", icase));
        assert!(wildmatch(b"foo", b"FOO", icase));
        assert!(!wildmatch(b"FOO", b"foo", NONE));
        // `\F` stays uppercase while the text byte is folded to lowercase.
        assert!(!wildmatch(b"\\F", b"f", icase));
        assert!(!wildmatch(b"\\F", b"F", icase));
        assert!(wildmatch(b"\\f", b"F", icase));
    }

    #[test]
    fn unterminated_class_aborts_even_behind_a_star() {
        assert!(!wildmatch(b"*[a", b"xa", NONE));
        assert!(!wildmatch(b"*[a", b"xa", PN));
    }

    #[test]
    fn empty_pattern_and_empty_text() {
        assert!(wildmatch(b"", b"", PN));
        assert!(!wildmatch(b"", b"x", PN));
        assert!(!wildmatch(b"x", b"", PN));
        assert!(wildmatch(b"*", b"", PN));
        assert!(wildmatch(b"**", b"", PN));
        assert!(!wildmatch(b"?", b"", PN));
    }

    #[test]
    fn pathological_star_runs_terminate() {
        // t3070-wildmatch.sh "matching does not exhibit exponential behavior".
        let mut text = vec![b'a'; 60];
        text.push(b'b');
        let pattern = b"*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a";
        assert!(!wildmatch(pattern, &text, PN));
        text.pop();
        assert!(wildmatch(pattern, &text, PN));

        // Long star runs that are not whole components collapse to one `*`.
        let many_stars = [b'*'; 256];
        assert!(wildmatch(&many_stars, b"anything", PN));
        let mut p = Vec::new();
        for _ in 0..64 {
            p.extend_from_slice(b"a*");
        }
        let t = [b'a'; 4096];
        assert!(!wildmatch(&p, &t[..63], PN));
        assert!(wildmatch(&p, &t[..64], PN));
        assert!(wildmatch(&p, &t, PN));
    }

    /// Exhaustive reference oracle: same per-construct rules as `dowild`
    /// (it reuses `star_kind` / `class_match`), but explores EVERY star
    /// split point recursively. Any false negative introduced by the
    /// iterative two-slot backtracking would show up as a disagreement.
    fn ref_wild(pat: &[u8], text: &[u8], flags: WildmatchFlags) -> bool {
        fn ref_at(pat: &[u8], text: &[u8], p: usize, t: usize, flags: WildmatchFlags) -> bool {
            let pathname = flags.contains(WildmatchFlags::PATHNAME);
            let fold = flags.contains(WildmatchFlags::CASEFOLD);
            if p == pat.len() {
                return t == text.len();
            }
            if pat[p] == b'*' {
                let mut q = p + 1;
                while q < pat.len() && pat[q] == b'*' {
                    q += 1;
                }
                let (match_slash, zero_dir) = star_kind(pat, p, q, pathname);
                if q == pat.len() {
                    return match_slash || memchr::memchr(b'/', &text[t..]).is_none();
                }
                if zero_dir && ref_at(pat, text, q + 1, t, flags) {
                    return true;
                }
                for j in t..=text.len() {
                    if j > t && !match_slash && text[j - 1] == b'/' {
                        break;
                    }
                    if ref_at(pat, text, q, j, flags) {
                        return true;
                    }
                }
                return false;
            }
            if t == text.len() {
                return false;
            }
            let tc_raw = text[t];
            let tc = fold_byte(tc_raw, fold);
            let (ok, next_p) = match pat[p] {
                b'?' => (!(pathname && tc_raw == b'/'), p + 1),
                b'[' => match class_match(pat, p, tc, fold) {
                    ClassMatch::Matched(after) => (!(pathname && tc_raw == b'/'), after),
                    ClassMatch::NotMatched => (false, p + 1),
                    ClassMatch::Malformed => return false,
                },
                b'\\' => (p + 1 < pat.len() && pat[p + 1] == tc, p + 2),
                c => (fold_byte(c, fold) == tc, p + 1),
            };
            ok && ref_at(pat, text, next_p, t + 1, flags)
        }
        ref_at(pat, text, 0, 0, flags)
    }

    /// Every pattern of up to 3 `/`-joined atoms against every text of up to
    /// 3 `/`-joined atoms, under both PATHNAME and no-PATHNAME, must agree
    /// with the exhaustive oracle (~200k combinations).
    #[test]
    fn exhaustive_agreement_with_reference_oracle() {
        const PAT_ATOMS: [&[u8]; 8] = [b"a", b"b", b"*", b"**", b"?", b"a*b", b"*a", b"[!b]"];
        const TEXT_ATOMS: [&[u8]; 5] = [b"a", b"b", b"ab", b"aab", b"abxc"];
        fn combos(atoms: &[&[u8]], max: usize) -> Vec<Vec<u8>> {
            let mut out: Vec<Vec<u8>> = vec![Vec::new()];
            let mut layer: Vec<Vec<u8>> = atoms.iter().map(|a| a.to_vec()).collect();
            for _ in 0..max {
                out.extend(layer.iter().cloned());
                layer = layer
                    .iter()
                    .flat_map(|prefix| {
                        atoms.iter().map(|a| {
                            let mut v = prefix.clone();
                            v.push(b'/');
                            v.extend_from_slice(a);
                            v
                        })
                    })
                    .collect();
            }
            out
        }
        let patterns = combos(&PAT_ATOMS, 3);
        let texts = combos(&TEXT_ATOMS, 3);
        let mut checked = 0u64;
        for pat in &patterns {
            for text in &texts {
                for flags in [PN, NONE] {
                    assert_eq!(
                        wildmatch(pat, text, flags),
                        ref_wild(pat, text, flags),
                        "pattern {:?} text {:?} flags {flags:?}",
                        bstr::BStr::new(pat),
                        bstr::BStr::new(text),
                    );
                    checked += 1;
                }
            }
        }
        assert_eq!(
            checked,
            (patterns.len() * texts.len() * 2) as u64,
            "expected the full cross product to be checked"
        );
    }

    #[test]
    fn non_ascii_bytes_compare_exactly() {
        assert!(wildmatch(b"caf\xc3\xa9", b"caf\xc3\xa9", PN));
        assert!(wildmatch(b"caf*", b"caf\xc3\xa9", PN));
        assert!(wildmatch(b"caf??", b"caf\xc3\xa9", PN));
        assert!(!wildmatch(b"caf?", b"caf\xc3\xa9", PN));
        assert!(wildmatch(b"[\xc3][\xa9]", b"\xc3\xa9", PN));
        // 0xDF..0xFF are not folded (ASCII-only casefold).
        assert!(!wildmatch(b"\xc3", b"\xe3", WildmatchFlags::CASEFOLD));
    }
}
