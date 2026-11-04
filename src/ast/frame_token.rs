//! The tokens JSC reports a stack frame at that the tree has no position for. The printer maps one where it starts a line, and finds it in the source text here. The ahead-of-time compiler asks here for the same tokens, so that it names the places the source map names.

use crate::{ExprData, ImportItemStatus, Loc, Symbol};
use bun_core::strings;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FrameToken {
    /// The `.` or `?.` in front of the name of a member. The `[` of a member is `Known`.
    Member,
    /// The end of the `?.` in front of the arguments of an optional call.
    OptionalCall,
    /// The end of the callee of a call, in front of its `(`. Where the source has a `?.` there that the transpiler does not print, the callee ends behind it.
    EndOfCallee,
    /// A token whose position the tree has: the `[` of a subscript or of a list that takes values, the `{` of an object that takes a rest, the backquote of a tag, the name that a callee is printed in place of.
    Known,
}

impl FrameToken {
    /// The token in `source`, looking back from `anchor` over the blanks and `(` of its line. None where anything else stands between, a line ends between, `first` has no position or the token is not behind it.
    pub fn find(self, source: &[u8], anchor: Loc, first: Loc) -> Option<Loc> {
        if self == FrameToken::Known {
            return Some(anchor);
        }
        let from = usize::try_from(anchor.start).ok()?;
        // What the transpiler made up has no position, and `anchor` need not stand behind its token: the React Compiler puts the name of a member where the member starts.
        if from > source.len() || first.is_empty() || anchor.start <= first.start {
            return None;
        }
        let mut at = from;
        let mut skipped_parenthesis = false;
        loop {
            let before = &source[..at];
            at -= match strings::js_whitespace_len_back(before) {
                0 if before.ends_with(b"(") => {
                    skipped_parenthesis = true;
                    1
                }
                0 => break,
                // Nothing is read on a line above: a comment may end there in what looks like the token.
                _ if strings::js_line_break_len_back(before) > 0 => return None,
                len => len,
            };
        }
        let before = &source[..at];
        let start = match self {
            FrameToken::Member => match before {
                [.., b'?', b'.'] => at - 2,
                [.., b'.'] => at - 1,
                _ => return None,
            },
            FrameToken::OptionalCall => match before {
                [.., b'?', b'.'] => at,
                _ => return None,
            },
            // Behind a callee that is never null the transpiler prints no `?.`. The text as written reports such a call where its `?.` ends.
            FrameToken::EndOfCallee => match before {
                [.., b')' | b'}' | b']' | b'`'] | [.., b'?', b'.'] if skipped_parenthesis => at,
                _ => return None,
            },
            FrameToken::Known => return Some(anchor),
        };
        let start = i32::try_from(start).ok()?;
        (start > first.start).then_some(Loc { start })
    }

    /// `find` where a source map has the token: where `behind`, and with it the token, is on another line than `in_front`, the last mapping in front. The printer applies the same rule by line number.
    pub fn find_on_new_line(
        self,
        text: &[u8],
        behind: Loc,
        first: Loc,
        in_front: Loc,
    ) -> Option<Loc> {
        if are_on_one_line(text, behind, in_front) {
            return None;
        }
        self.find(text, behind, first)
    }
}

/// Whether no line of `source` ends between the two positions: a source map has both on one line.
pub fn are_on_one_line(source: &[u8], a: Loc, b: Loc) -> bool {
    let (Ok(a), Ok(b)) = (usize::try_from(a.start), usize::try_from(b.start)) else {
        return true;
    };
    let (from, to) = (a.min(b).min(source.len()), a.max(b).min(source.len()));
    !strings::contains_js_line_break(&source[from..to])
}

/// Whether the printer writes `data` as a name. JSC reports a name that is not defined where the name ends: a token mapped right behind it would take that frame. An import is not listed: `is_import_printed_as_name` asks its symbol.
#[inline]
pub fn is_identifier_kind(data: &ExprData) -> bool {
    matches!(
        data,
        ExprData::EIdentifier(_)
            | ExprData::ECommonjsExportIdentifier(_)
            | ExprData::ERequireCallTarget
            | ExprData::ERequireResolveCallTarget
    )
}

/// Whether the printer writes the import that `symbol` is as a name. One that is read from a namespace is printed `X.name`: a member of a TypeScript namespace or enum that another block declares, or what a bundle imports from a CommonJS module.
#[inline]
pub fn is_import_printed_as_name(symbol: &Symbol, minify_syntax: bool) -> bool {
    // One that is missing is printed `undefined`, or `void 0` where syntax is minified. One without an alias is printed as its namespace alone.
    match symbol.import_item_status {
        ImportItemStatus::Missing => !minify_syntax,
        _ => (symbol.namespace_alias.as_ref()).is_none_or(|namespace| namespace.alias.is_empty()),
    }
}

/// Whether a callee ends in a name: a name, an import, a member behind a dot or `super`. JSC reports its call at that name, not in front of the `(`.
#[inline]
pub fn callee_ends_in_name(callee: &ExprData) -> bool {
    is_identifier_kind(callee)
        || matches!(
            callee,
            ExprData::EImportIdentifier(_) | ExprData::EDot(_) | ExprData::ESuper(_)
        )
}

/// Whether a callee that does not end in a name is written in front of its call: what a name held is printed in place of that name. Any other such call starts where its callee does, or has a callee that the transpiler made up, without a position.
#[inline]
pub fn callee_is_written_in_front(callee: Loc, call: Loc) -> bool {
    !callee.is_empty() && callee.start < call.start
}

#[cfg(test)]
mod tests {
    use super::FrameToken::{EndOfCallee, Known, Member, OptionalCall};
    use super::*;

    /// Where the last `text` of `source` starts.
    fn position(source: &str, text: &str) -> Loc {
        let at = strings::last_index_of(source.as_bytes(), text.as_bytes());
        let at = at.expect("the text is in the source");
        Loc {
            start: i32::try_from(at).unwrap(),
        }
    }

    fn find(token: FrameToken, source: &str, anchor: &str, first: i32) -> Option<i32> {
        let anchor = position(source, anchor);
        let found = token.find(source.as_bytes(), anchor, Loc { start: first });
        found.map(|loc| loc.start)
    }

    fn find_on_new_line(token: FrameToken, text: &str, behind: &str) -> Option<i32> {
        let (behind, first) = (position(text, behind), Loc { start: 0 });
        let found = token.find_on_new_line(text.as_bytes(), behind, first, first);
        found.map(|loc| loc.start)
    }

    #[test]
    fn a_member_is_found_at_its_punctuator() {
        assert_eq!(find(Member, "a\n  .b", "b", 0), Some(4));
        assert_eq!(find(Member, "a\n  ?.b", "b", 0), Some(4));
        assert_eq!(find(Member, "a\n  . b", "b", 0), Some(4));
        assert_eq!(find(Member, "o\n  .a\n  .b;", "a\n", 0), Some(4));
        assert_eq!(find(Member, "o\n  .a\n  .b;", "b;", 0), Some(9));
        assert_eq!(find(Member, "a /* c */ b", "b", 0), None);
        assert_eq!(find(Member, "a. /* c */ b", "b", 0), None);
    }

    #[test]
    fn a_bracket_is_no_token_of_a_member() {
        // A key in brackets that is printed behind a dot gets no mapping of its `[`.
        assert_eq!(find(Member, "a\n  [\"b\"]", "\"b\"", 0), None);
        assert_eq!(find(Member, "a\n  [(\"b\")]", "\"b\"", 0), None);
        assert_eq!(find(Member, "a?.[\"b\"]", "\"b\"", 0), None);
    }

    #[test]
    fn a_call_is_found_behind_its_callee() {
        assert_eq!(find(EndOfCallee, "(() => {\n})(1)", "1", 0), Some(11));
        assert_eq!(find(EndOfCallee, "(() => {\n})();", ");", 0), Some(11));
        assert_eq!(find(EndOfCallee, "f()((1))", "1", 0), Some(3));
        assert_eq!(find(EndOfCallee, "(f(2)\n) (1);", "1);", 0), Some(7));
        assert_eq!(find(EndOfCallee, "f(1)", "1", 0), None);
        assert_eq!(find(OptionalCall, "f\n  ?.(1)", "1", 0), Some(6));
        assert_eq!(find(OptionalCall, "f\n  ?. ( (1))", "1", 0), Some(6));
    }

    #[test]
    fn a_known_token_is_where_the_tree_has_it() {
        assert_eq!(find(Known, "[a]", "[", 0), Some(0));
        // What stands between it and the mapping in front is not read.
        assert_eq!(find_on_new_line(Known, "f()\n  [k]", "["), Some(6));
        assert_eq!(find_on_new_line(Known, "f() // [\n  [k]", "[k"), Some(11));
        assert_eq!(find_on_new_line(Known, "f\n`x`", "`x"), Some(2));
        // A lookup finds a token on the line of the mapping in front as it is.
        assert_eq!(find_on_new_line(Known, "f()[\n  k\n]", "["), None);
        assert_eq!(find_on_new_line(Known, "f`x`", "`x"), None);
    }

    #[test]
    fn the_bracket_of_a_member_is_read_back_from_its_offset() {
        use crate::E::Index;
        let member = |bracket_offset| Index {
            index: crate::Expr::EMPTY,
            target: crate::Expr::EMPTY,
            optional_chain: None,
            is_import_property_use: false,
            bracket_offset,
        };
        let source = "x = f()\n  [[p][0]];";
        let (start, bracket) = (position(source, "f()"), position(source, "[["));
        let index = member(Index::bracket_offset_of(start, bracket));
        assert_eq!(index.bracket_loc(start), Some(bracket));
        // That `[` starts a line behind `f()`, whatever its key is printed as.
        let found = Known.find_on_new_line(source.as_bytes(), bracket, start, start);
        assert_eq!(found, Some(bracket));
        // An expression without a position has no `[`, and neither has one that no parser read.
        assert_eq!(index.bracket_loc(Loc::EMPTY), None);
        assert_eq!(member(Index::BRACKET_NOT_KNOWN).bracket_loc(start), None);
        // Where `bracket_loc` has a `[` that was read `offset` bytes behind an expression at 7.
        let read_back = |offset: i32| {
            let (start, bracket) = (Loc { start: 7 }, Loc { start: 7 + offset });
            member(Index::bracket_offset_of(start, bracket)).bracket_loc(start)
        };
        assert_eq!(read_back(1), Some(Loc { start: 8 }));
        assert_eq!(read_back(65_535), Some(Loc { start: 65_542 }));
        // Too far behind the start for the field, at the start, in front of it: not known.
        assert_eq!(read_back(65_536), None);
        assert_eq!(read_back(0), None);
        assert_eq!(read_back(-3), None);
    }

    #[test]
    fn blanks_that_are_not_ascii_are_stepped_over() {
        assert_eq!(find(Member, "a\n\u{A0}.\u{3000}b", "b", 0), Some(4));
        assert_eq!(
            find(OptionalCall, "f\u{2028}?.\u{FEFF}(\u{A0}1)", "1", 0),
            Some(6)
        );
        assert_eq!(find(EndOfCallee, "f()\u{A0}(\u{3000}1)", "1", 0), Some(3));
    }

    #[test]
    fn a_token_on_a_line_above_its_anchor_is_not_found() {
        for line_break in ["\n", "\r", "\r\n", "\u{2028}", "\u{2029}"] {
            let shapes = [
                (Member, format!("a.{line_break}  b"), "b"),
                (Member, format!("a?.{line_break}  b"), "b"),
                (Member, format!("f(){line_break}.{line_break}b"), "b"),
                (EndOfCallee, format!("f(){line_break}  (1)"), "1"),
                (
                    EndOfCallee,
                    format!("(f{line_break}){line_break}  (1)"),
                    "1",
                ),
                (EndOfCallee, format!("(() => 0)({line_break}  1)"), "1"),
                (EndOfCallee, format!("[1]?.({line_break}  2)"), "2"),
                (OptionalCall, format!("f?.({line_break}  1)"), "1"),
                (OptionalCall, format!("f?.{line_break}  (1)"), "1"),
            ];
            for (token, source, anchor) in shapes {
                assert_eq!(find(token, &source, anchor, 0), None, "{source:?}");
            }
            // The same tokens behind the line break are found.
            let member = format!("a{line_break}  .b");
            assert_eq!(
                find(Member, &member, "b", 0),
                Some(3 + line_break.len() as i32)
            );
            let call = format!("(f{line_break})(1)");
            assert_eq!(
                find(EndOfCallee, &call, "1", 0),
                Some(3 + line_break.len() as i32)
            );
        }
        // A comment on the line above ends in a `.`, a `)` or a `?.(`: none of them is taken for the token.
        let member = "g().\n/* c */ --> see note.\n    name;";
        assert_eq!(find(Member, member, "name", 0), None);
        assert_eq!(find(EndOfCallee, "f()\n// note)\n(1);", "1);", 0), None);
        assert_eq!(
            find(OptionalCall, "f()?.(\n  // maybe?.(\n  1);", "1);", 0),
            None
        );
    }

    #[test]
    fn what_was_written_elsewhere_is_not_found() {
        // The name of `o.b` where the tree has it at the `b` of `a.b`: the `.` in front of that stands in front of `o`.
        assert_eq!(find(Member, "a.b;\no.c", "b", 5), None);
        assert_eq!(find(Member, "a.b;\no.c", "c", 5), Some(6));
    }

    #[test]
    fn no_token_is_found_behind_what_has_no_position() {
        let nowhere = Loc::EMPTY.start;
        // `(a || b).x` as the React Compiler rebuilds it: the choice has no position and the name stands at `a`. The `.` in front is of a spread.
        let member = "f(...(a || b).x)";
        assert_eq!(find(Member, member, "a ", 0), Some(4));
        assert_eq!(find(Member, member, "a ", nowhere), None);
        let call = "f?.((a || b).x)";
        assert_eq!(find(OptionalCall, call, "a ", 0), Some(3));
        assert_eq!(find(OptionalCall, call, "a ", nowhere), None);
        // Nor is the end of a callee that has no position looked for.
        assert_eq!(find(EndOfCallee, "(a\n  || b)(x)", "x", 0), Some(10));
        assert_eq!(find(EndOfCallee, "(a\n  || b)(x)", "x", nowhere), None);
    }

    #[test]
    fn a_callee_is_in_front_of_its_call_only_with_a_position_there() {
        let source = "const once = f();\nonce(1);\nfunction later() {}";
        let (held, call) = (position(source, "f()"), position(source, "once(1)"));
        // `f()` is printed in place of `once`: the call stays where the name is written.
        assert!(callee_is_written_in_front(held, call));
        // A call that is parsed starts where its callee does, and a function may be declared behind its call.
        assert!(!callee_is_written_in_front(call, call));
        assert!(!callee_is_written_in_front(position(source, "later"), call));
        // What the transpiler makes up has no position.
        assert!(!callee_is_written_in_front(Loc::EMPTY, call));
        assert!(!callee_is_written_in_front(Loc::EMPTY, Loc::EMPTY));
        assert!(!callee_is_written_in_front(held, Loc::EMPTY));
    }

    #[test]
    fn a_callee_ends_behind_an_optional_chain_that_is_not_printed() {
        // `[1]?.(2)` is printed `[1](2)`: the call is reported where the `?.` ends, whatever the callee ends in.
        assert_eq!(find(EndOfCallee, "[1]\n  ?.(2)", "2", 0), Some(8));
        assert_eq!(find(EndOfCallee, "[1]\n  ?. ( (2))", "2", 0), Some(8));
        assert_eq!(find(EndOfCallee, "1\n  ?.(2)", "2", 0), Some(6));
        assert_eq!(
            find(EndOfCallee, "(function () {\n})\n  ?.()", ")", 0),
            Some(22)
        );
        // Without a `(` behind it the `?.` is that of a member.
        assert_eq!(find(EndOfCallee, "[1]\n  ?.b", "b", 0), None);
        assert_eq!(find_on_new_line(EndOfCallee, "[1]\n  ?.(2)", "2"), Some(8));
    }

    #[test]
    fn a_token_is_found_only_where_it_starts_a_line() {
        assert_eq!(find_on_new_line(Member, "f().b", "b"), None);
        assert_eq!(find_on_new_line(Member, "f()\n  .b", "b"), Some(6));
        assert_eq!(find_on_new_line(Member, "f()\r\n  .b", "b"), Some(7));
        assert_eq!(find_on_new_line(OptionalCall, "f()\n  ?.(1)", "1"), Some(8));
        assert_eq!(find_on_new_line(EndOfCallee, "(f)(1)", "1"), None);
        assert_eq!(find_on_new_line(EndOfCallee, "(f\n)(1)", "1"), Some(4));
        // A lookup finds a token that ends the line of the mapping in front as it is.
        assert_eq!(find_on_new_line(Member, "f().\n  b", "b"), None);
        assert_eq!(find_on_new_line(EndOfCallee, "(f)\n  (1)", "1"), None);
        assert_eq!(find_on_new_line(EndOfCallee, "[1]?.\n  (2)", "2"), None);
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
        assert!(on_one_line("a\n.b", -1, 3));
        assert!(on_one_line("a\n.b", 9, 12));
    }
}
