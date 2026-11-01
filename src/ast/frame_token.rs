//! The tokens that JSC reports a stack frame at and that the tree has no position for.
//!
//! JSC reports a read of `a.b` at the `.`, a call of `f()()` behind `f()`, and `for (x of y)` at the `of`. The printer
//! maps the name, the argument or the iterable behind such a token. A lookup of the token then finds the mapping in
//! front of it, which names the right line as long as the token stands on that line. Where it does not, the printer
//! maps the token itself. Its position is read from the source text here, by one rule for the printer and for whoever
//! has to know what the printer maps (the ahead-of-time compiler).

use crate::Loc;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FrameToken {
    /// The `.`, `?.` or `[` in front of the name or the index of a member.
    Member,
    /// The end of the `?.` in front of the arguments of an optional call.
    OptionalCall,
    /// The end of the callee of a call, in front of its `(`.
    EndOfCallee,
    /// The `of` of a `for`-`of` head.
    Of,
    /// The `...` in front of what an object literal spreads.
    Spread,
    /// A token whose position the printer knows.
    Known,
}

impl FrameToken {
    /// Where the token is in `source`, looking back from `anchor`, the position of what the printer maps behind it.
    /// None where anything but blanks stands in between (and `(`, which the parser does not keep), and where the
    /// token is not behind `first`: the text at `anchor` was then written somewhere else.
    pub fn find(self, source: &[u8], anchor: Loc, first: Loc) -> Option<Loc> {
        if self == FrameToken::Known {
            return Some(anchor);
        }
        let mut at = usize::try_from(anchor.start).ok()?;
        if at > source.len() || anchor.start <= first.start {
            return None;
        }
        let mut skipped_parenthesis = false;
        while at > 0 {
            match source[at - 1] {
                b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => {}
                b'(' => skipped_parenthesis = true,
                _ => break,
            }
            at -= 1;
        }
        let before = &source[..at];
        let start = match self {
            // `a["b"]` may be printed `a.b`, and the other way around.
            FrameToken::Member => match before {
                [.., b'?', b'.'] => at - 2,
                [.., b'.' | b'['] => at - 1,
                _ => return None,
            },
            FrameToken::OptionalCall => match before {
                [.., b'?', b'.'] => at,
                _ => return None,
            },
            FrameToken::EndOfCallee => match before {
                [.., b')' | b'}' | b']' | b'`'] if skipped_parenthesis => at,
                _ => return None,
            },
            FrameToken::Spread => match before {
                [.., b'.', b'.', b'.'] => at - 3,
                _ => return None,
            },
            FrameToken::Of => match before {
                [.., b'o', b'f'] => match before[..at - 2].last() {
                    Some(&c)
                        if c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80 =>
                    {
                        return None;
                    }
                    _ => at - 2,
                },
                _ => return None,
            },
            FrameToken::Known => return Some(anchor),
        };
        let start = i32::try_from(start).ok()?;
        (start > first.start).then_some(Loc { start })
    }
}

/// Whether no line of `source` ends between the two positions: a source map has both on one line.
pub fn are_on_one_line(source: &[u8], a: Loc, b: Loc) -> bool {
    let (Ok(a), Ok(b)) = (usize::try_from(a.start), usize::try_from(b.start)) else {
        return true;
    };
    let (from, to) = (a.min(b), a.max(b).min(source.len()));
    let mut at = from;
    while at < to {
        match source[at] {
            b'\n' => return false,
            b'\r' if source.get(at + 1) != Some(&b'\n') => return false,
            // U+2028 and U+2029
            0xE2 if source.get(at + 1) == Some(&0x80)
                && matches!(source.get(at + 2), Some(0xA8 | 0xA9)) =>
            {
                return false;
            }
            _ => {}
        }
        at += 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find(token: FrameToken, source: &str, anchor: &str, first: i32) -> Option<i32> {
        let anchor =
            i32::try_from(source.find(anchor).expect("the anchor is in the text")).unwrap();
        let found = token.find(
            source.as_bytes(),
            Loc { start: anchor },
            Loc { start: first },
        );
        found.map(|loc| loc.start)
    }

    #[test]
    fn a_member_is_found_at_its_punctuator() {
        assert_eq!(find(FrameToken::Member, "a\n  .b", "b", 0), Some(4));
        assert_eq!(find(FrameToken::Member, "a\n  ?.b", "b", 0), Some(4));
        assert_eq!(find(FrameToken::Member, "a\n  [ (b)]", "b", 0), Some(4));
        assert_eq!(find(FrameToken::Member, "a?.[b]", "b", 0), Some(3));
        assert_eq!(find(FrameToken::Member, "a /* c */ b", "b", 0), None);
    }

    #[test]
    fn a_call_is_found_behind_its_callee() {
        assert_eq!(
            find(FrameToken::EndOfCallee, "(() => {\n})(1)", "1", 0),
            Some(11)
        );
        assert_eq!(
            find(FrameToken::EndOfCallee, "f()\n  ((1))", "1", 0),
            Some(3)
        );
        assert_eq!(find(FrameToken::EndOfCallee, "f(1)", "1", 0), None);
        assert_eq!(
            find(FrameToken::OptionalCall, "f\n  ?.(1)", "1", 0),
            Some(6)
        );
        assert_eq!(
            find(FrameToken::OptionalCall, "f\n  ?. ( (1))", "1", 0),
            Some(6)
        );
    }

    #[test]
    fn the_other_tokens() {
        assert_eq!(
            find(FrameToken::Of, "for (const x\n  of (y)) {}", "y", 0),
            Some(15)
        );
        assert_eq!(
            find(FrameToken::Of, "for (const x\n  proof y) {}", "y", 0),
            None
        );
        assert_eq!(
            find(FrameToken::Spread, "({ a,\n  ...(b) })", "b", -1),
            Some(8)
        );
        assert_eq!(find(FrameToken::Known, "[a]", "[", 0), Some(0));
    }

    #[test]
    fn what_was_written_elsewhere_is_not_found() {
        // The key of `o[KEY]` where `KEY` is printed as its value: the value stands in front of `o`.
        assert_eq!(
            find(FrameToken::Member, "const KEY = [1];\no[KEY]", "1", 17),
            None
        );
    }

    #[test]
    fn lines() {
        let on_one_line = |source: &str, a: i32, b: i32| {
            are_on_one_line(source.as_bytes(), Loc { start: a }, Loc { start: b })
        };
        assert!(on_one_line("a.b", 0, 2));
        assert!(!on_one_line("a\n.b", 0, 2));
        assert!(!on_one_line("a\n.b", 2, 0));
        assert!(!on_one_line("a\r\n.b", 0, 3));
        assert!(!on_one_line("a\r.b", 0, 2));
        assert!(!on_one_line("a\u{2028}.b", 0, 4));
        assert!(on_one_line("a\n.b", 2, 3));
    }
}
