//! Conformance corpus ported from git.git `t/t3070-wildmatch.sh`.
//!
//! Each entry is one `match` line from that script:
//! `(wildmatch, iwildmatch, pathmatch, ipathmatch, text, pattern)`, where the
//! four expectations correspond to `WM_PATHNAME`, `WM_PATHNAME|WM_CASEFOLD`,
//! no flags, and `WM_CASEFOLD` (see git.git `t/helper/test-wildmatch.c`).
//! For the 10-argument `match` lines (where `git ls-files` disagrees with the
//! matcher) the first four columns — the `test-tool wildmatch` truth — are used.

use bstr::BStr;

use crate::wildmatch::{WildmatchFlags, wildmatch};

type Case = (u8, u8, u8, u8, &'static [u8], &'static [u8]);

#[rustfmt::skip]
const T3070_CASES: &[Case] = &[
    // Basic wildmatch features
    (1, 1, 1, 1, b"foo", b"foo"),
    (0, 0, 0, 0, b"foo", b"bar"),
    (1, 1, 1, 1, b"", b""),
    (1, 1, 1, 1, b"foo", b"???"),
    (0, 0, 0, 0, b"foo", b"??"),
    (1, 1, 1, 1, b"foo", b"*"),
    (1, 1, 1, 1, b"foo", b"f*"),
    (0, 0, 0, 0, b"foo", b"*f"),
    (1, 1, 1, 1, b"foo", b"*foo*"),
    (1, 1, 1, 1, b"foobar", b"*ob*a*r*"),
    (1, 1, 1, 1, b"aaaaaaabababab", b"*ab"),
    (1, 1, 1, 1, b"foo*", b"foo\\*"),
    (0, 0, 0, 0, b"foobar", b"foo\\*bar"),
    (1, 1, 1, 1, b"f\\oo", b"f\\\\oo"),
    (0, 0, 0, 0, b"foo\\", b"foo\\"),
    (1, 1, 1, 1, b"ball", b"*[al]?"),
    (0, 0, 0, 0, b"ten", b"[ten]"),
    (1, 1, 1, 1, b"ten", b"**[!te]"),
    (0, 0, 0, 0, b"ten", b"**[!ten]"),
    (1, 1, 1, 1, b"ten", b"t[a-g]n"),
    (0, 0, 0, 0, b"ten", b"t[!a-g]n"),
    (1, 1, 1, 1, b"ton", b"t[!a-g]n"),
    (1, 1, 1, 1, b"ton", b"t[^a-g]n"),
    (1, 1, 1, 1, b"a]b", b"a[]]b"),
    (1, 1, 1, 1, b"a-b", b"a[]-]b"),
    (1, 1, 1, 1, b"a]b", b"a[]-]b"),
    (0, 0, 0, 0, b"aab", b"a[]-]b"),
    (1, 1, 1, 1, b"aab", b"a[]a-]b"),
    (1, 1, 1, 1, b"]", b"]"),
    // Extended slash-matching features
    (0, 0, 1, 1, b"foo/baz/bar", b"foo*bar"),
    (0, 0, 1, 1, b"foo/baz/bar", b"foo**bar"),
    (1, 1, 1, 1, b"foobazbar", b"foo**bar"),
    (1, 1, 1, 1, b"foo/baz/bar", b"foo/**/bar"),
    (1, 1, 0, 0, b"foo/baz/bar", b"foo/**/**/bar"),
    (1, 1, 1, 1, b"foo/b/a/z/bar", b"foo/**/bar"),
    (1, 1, 1, 1, b"foo/b/a/z/bar", b"foo/**/**/bar"),
    (1, 1, 0, 0, b"foo/bar", b"foo/**/bar"),
    (1, 1, 0, 0, b"foo/bar", b"foo/**/**/bar"),
    (0, 0, 1, 1, b"foo/bar", b"foo?bar"),
    (0, 0, 1, 1, b"foo/bar", b"foo[/]bar"),
    (0, 0, 1, 1, b"foo/bar", b"foo[^a-z]bar"),
    (0, 0, 1, 1, b"foo/bar", b"f[^eiu][^eiu][^eiu][^eiu][^eiu]r"),
    (1, 1, 1, 1, b"foo-bar", b"f[^eiu][^eiu][^eiu][^eiu][^eiu]r"),
    (1, 1, 0, 0, b"foo", b"**/foo"),
    (1, 1, 1, 1, b"XXX/foo", b"**/foo"),
    (1, 1, 1, 1, b"bar/baz/foo", b"**/foo"),
    (0, 0, 1, 1, b"bar/baz/foo", b"*/foo"),
    (0, 0, 1, 1, b"foo/bar/baz", b"**/bar*"),
    (1, 1, 1, 1, b"deep/foo/bar/baz", b"**/bar/*"),
    (0, 0, 1, 1, b"deep/foo/bar/baz/", b"**/bar/*"),
    (1, 1, 1, 1, b"deep/foo/bar/baz/", b"**/bar/**"),
    (0, 0, 0, 0, b"deep/foo/bar", b"**/bar/*"),
    (1, 1, 1, 1, b"deep/foo/bar/", b"**/bar/**"),
    (0, 0, 1, 1, b"foo/bar/baz", b"**/bar**"),
    (1, 1, 1, 1, b"foo/bar/baz/x", b"*/bar/**"),
    (0, 0, 1, 1, b"deep/foo/bar/baz/x", b"*/bar/**"),
    (1, 1, 1, 1, b"deep/foo/bar/baz/x", b"**/bar/*/*"),
    // Various additional tests
    (0, 0, 0, 0, b"acrt", b"a[c-c]st"),
    (1, 1, 1, 1, b"acrt", b"a[c-c]rt"),
    (0, 0, 0, 0, b"]", b"[!]-]"),
    (1, 1, 1, 1, b"a", b"[!]-]"),
    (0, 0, 0, 0, b"", b"\\"),
    (0, 0, 0, 0, b"\\", b"\\"),
    (0, 0, 0, 0, b"XXX/\\", b"*/\\"),
    (1, 1, 1, 1, b"XXX/\\", b"*/\\\\"),
    (1, 1, 1, 1, b"foo", b"foo"),
    (1, 1, 1, 1, b"@foo", b"@foo"),
    (0, 0, 0, 0, b"foo", b"@foo"),
    (1, 1, 1, 1, b"[ab]", b"\\[ab]"),
    (1, 1, 1, 1, b"[ab]", b"[[]ab]"),
    (1, 1, 1, 1, b"[ab]", b"[[:]ab]"),
    (0, 0, 0, 0, b"[ab]", b"[[::]ab]"),
    (1, 1, 1, 1, b"[ab]", b"[[:digit]ab]"),
    (1, 1, 1, 1, b"[ab]", b"[\\[:]ab]"),
    (1, 1, 1, 1, b"?a?b", b"\\??\\?b"),
    (1, 1, 1, 1, b"abc", b"\\a\\b\\c"),
    (0, 0, 0, 0, b"foo", b""),
    (1, 1, 1, 1, b"foo/bar/baz/to", b"**/t[o]"),
    // Character class tests
    (1, 1, 1, 1, b"a1B", b"[[:alpha:]][[:digit:]][[:upper:]]"),
    (0, 1, 0, 1, b"a", b"[[:digit:][:upper:][:space:]]"),
    (1, 1, 1, 1, b"A", b"[[:digit:][:upper:][:space:]]"),
    (1, 1, 1, 1, b"1", b"[[:digit:][:upper:][:space:]]"),
    (0, 0, 0, 0, b"1", b"[[:digit:][:upper:][:spaci:]]"),
    (1, 1, 1, 1, b" ", b"[[:digit:][:upper:][:space:]]"),
    (0, 0, 0, 0, b".", b"[[:digit:][:upper:][:space:]]"),
    (1, 1, 1, 1, b".", b"[[:digit:][:punct:][:space:]]"),
    (1, 1, 1, 1, b"5", b"[[:xdigit:]]"),
    (1, 1, 1, 1, b"f", b"[[:xdigit:]]"),
    (1, 1, 1, 1, b"D", b"[[:xdigit:]]"),
    (1, 1, 1, 1, b"_", b"[[:alnum:][:alpha:][:blank:][:cntrl:][:digit:][:graph:][:lower:][:print:][:punct:][:space:][:upper:][:xdigit:]]"),
    (1, 1, 1, 1, b".", b"[^[:alnum:][:alpha:][:blank:][:cntrl:][:digit:][:lower:][:space:][:upper:][:xdigit:]]"),
    (1, 1, 1, 1, b"5", b"[a-c[:digit:]x-z]"),
    (1, 1, 1, 1, b"b", b"[a-c[:digit:]x-z]"),
    (1, 1, 1, 1, b"y", b"[a-c[:digit:]x-z]"),
    (0, 0, 0, 0, b"q", b"[a-c[:digit:]x-z]"),
    // Additional tests, including some malformed wildmatch patterns
    (1, 1, 1, 1, b"]", b"[\\\\-^]"),
    (0, 0, 0, 0, b"[", b"[\\\\-^]"),
    (1, 1, 1, 1, b"-", b"[\\-_]"),
    (1, 1, 1, 1, b"]", b"[\\]]"),
    (0, 0, 0, 0, b"\\]", b"[\\]]"),
    (0, 0, 0, 0, b"\\", b"[\\]]"),
    (0, 0, 0, 0, b"ab", b"a[]b"),
    (0, 0, 0, 0, b"a[]b", b"a[]b"),
    (0, 0, 0, 0, b"ab[", b"ab["),
    (0, 0, 0, 0, b"ab", b"[!"),
    (0, 0, 0, 0, b"ab", b"[-"),
    (1, 1, 1, 1, b"-", b"[-]"),
    (0, 0, 0, 0, b"-", b"[a-"),
    (0, 0, 0, 0, b"-", b"[!a-"),
    (1, 1, 1, 1, b"-", b"[--A]"),
    (1, 1, 1, 1, b"5", b"[--A]"),
    (1, 1, 1, 1, b" ", b"[ --]"),
    (1, 1, 1, 1, b"$", b"[ --]"),
    (1, 1, 1, 1, b"-", b"[ --]"),
    (0, 0, 0, 0, b"0", b"[ --]"),
    (1, 1, 1, 1, b"-", b"[---]"),
    (1, 1, 1, 1, b"-", b"[------]"),
    (0, 0, 0, 0, b"j", b"[a-e-n]"),
    (1, 1, 1, 1, b"-", b"[a-e-n]"),
    (1, 1, 1, 1, b"a", b"[!------]"),
    (0, 0, 0, 0, b"[", b"[]-a]"),
    (1, 1, 1, 1, b"^", b"[]-a]"),
    (0, 0, 0, 0, b"^", b"[!]-a]"),
    (1, 1, 1, 1, b"[", b"[!]-a]"),
    (1, 1, 1, 1, b"^", b"[a^bc]"),
    (1, 1, 1, 1, b"-b]", b"[a-]b]"),
    (0, 0, 0, 0, b"\\", b"[\\]"),
    (1, 1, 1, 1, b"\\", b"[\\\\]"),
    (0, 0, 0, 0, b"\\", b"[!\\\\]"),
    (1, 1, 1, 1, b"G", b"[A-\\\\]"),
    (0, 0, 0, 0, b"aaabbb", b"b*a"),
    (0, 0, 0, 0, b"aabcaa", b"*ba*"),
    (1, 1, 1, 1, b",", b"[,]"),
    (1, 1, 1, 1, b",", b"[\\\\,]"),
    (1, 1, 1, 1, b"\\", b"[\\\\,]"),
    (1, 1, 1, 1, b"-", b"[,-.]"),
    (0, 0, 0, 0, b"+", b"[,-.]"),
    (0, 0, 0, 0, b"-.]", b"[,-.]"),
    (1, 1, 1, 1, b"2", b"[\\1-\\3]"),
    (1, 1, 1, 1, b"3", b"[\\1-\\3]"),
    (0, 0, 0, 0, b"4", b"[\\1-\\3]"),
    (1, 1, 1, 1, b"\\", b"[[-\\]]"),
    (1, 1, 1, 1, b"[", b"[[-\\]]"),
    (1, 1, 1, 1, b"]", b"[[-\\]]"),
    (0, 0, 0, 0, b"-", b"[[-\\]]"),
    // Test recursion
    (1, 1, 1, 1, b"-adobe-courier-bold-o-normal--12-120-75-75-m-70-iso8859-1", b"-*-*-*-*-*-*-12-*-*-*-m-*-*-*"),
    (0, 0, 0, 0, b"-adobe-courier-bold-o-normal--12-120-75-75-X-70-iso8859-1", b"-*-*-*-*-*-*-12-*-*-*-m-*-*-*"),
    (0, 0, 0, 0, b"-adobe-courier-bold-o-normal--12-120-75-75-/-70-iso8859-1", b"-*-*-*-*-*-*-12-*-*-*-m-*-*-*"),
    (1, 1, 1, 1, b"XXX/adobe/courier/bold/o/normal//12/120/75/75/m/70/iso8859/1", b"XXX/*/*/*/*/*/*/12/*/*/*/m/*/*/*"),
    (0, 0, 0, 0, b"XXX/adobe/courier/bold/o/normal//12/120/75/75/X/70/iso8859/1", b"XXX/*/*/*/*/*/*/12/*/*/*/m/*/*/*"),
    (1, 1, 1, 1, b"abcd/abcdefg/abcdefghijk/abcdefghijklmnop.txt", b"**/*a*b*g*n*t"),
    (0, 0, 0, 0, b"abcd/abcdefg/abcdefghijk/abcdefghijklmnop.txtz", b"**/*a*b*g*n*t"),
    (0, 0, 0, 0, b"foo", b"*/*/*"),
    (0, 0, 0, 0, b"foo/bar", b"*/*/*"),
    (1, 1, 1, 1, b"foo/bba/arr", b"*/*/*"),
    (0, 0, 1, 1, b"foo/bb/aa/rr", b"*/*/*"),
    (1, 1, 1, 1, b"foo/bb/aa/rr", b"**/**/**"),
    (1, 1, 1, 1, b"abcXdefXghi", b"*X*i"),
    (0, 0, 1, 1, b"ab/cXd/efXg/hi", b"*X*i"),
    (1, 1, 1, 1, b"ab/cXd/efXg/hi", b"*/*X*/*/*i"),
    (1, 1, 1, 1, b"ab/cXd/efXg/hi", b"**/*X*/**/*i"),
    // Extra pathmatch tests
    (0, 0, 0, 0, b"foo", b"fo"),
    (1, 1, 1, 1, b"foo/bar", b"foo/bar"),
    (1, 1, 1, 1, b"foo/bar", b"foo/*"),
    (0, 0, 1, 1, b"foo/bba/arr", b"foo/*"),
    (1, 1, 1, 1, b"foo/bba/arr", b"foo/**"),
    (0, 0, 1, 1, b"foo/bba/arr", b"foo*"),
    (0, 0, 1, 1, b"foo/bba/arr", b"foo**"),
    (0, 0, 1, 1, b"foo/bba/arr", b"foo/*arr"),
    (0, 0, 1, 1, b"foo/bba/arr", b"foo/**arr"),
    (0, 0, 0, 0, b"foo/bba/arr", b"foo/*z"),
    (0, 0, 0, 0, b"foo/bba/arr", b"foo/**z"),
    (0, 0, 1, 1, b"foo/bar", b"foo?bar"),
    (0, 0, 1, 1, b"foo/bar", b"foo[/]bar"),
    (0, 0, 1, 1, b"foo/bar", b"foo[^a-z]bar"),
    (0, 0, 1, 1, b"ab/cXd/efXg/hi", b"*Xg*i"),
    // Extra case-sensitivity tests
    (0, 1, 0, 1, b"a", b"[A-Z]"),
    (1, 1, 1, 1, b"A", b"[A-Z]"),
    (0, 1, 0, 1, b"A", b"[a-z]"),
    (1, 1, 1, 1, b"a", b"[a-z]"),
    (0, 1, 0, 1, b"a", b"[[:upper:]]"),
    (1, 1, 1, 1, b"A", b"[[:upper:]]"),
    (0, 1, 0, 1, b"A", b"[[:lower:]]"),
    (1, 1, 1, 1, b"a", b"[[:lower:]]"),
    (0, 1, 0, 1, b"A", b"[B-Za]"),
    (1, 1, 1, 1, b"a", b"[B-Za]"),
    (0, 1, 0, 1, b"A", b"[B-a]"),
    (1, 1, 1, 1, b"a", b"[B-a]"),
    (0, 1, 0, 1, b"z", b"[Z-y]"),
    (1, 1, 1, 1, b"Z", b"[Z-y]"),
];

#[test]
fn t3070_wildmatch_corpus() {
    let modes: [(&str, WildmatchFlags); 4] = [
        ("wildmatch", WildmatchFlags::PATHNAME),
        (
            "iwildmatch",
            WildmatchFlags::PATHNAME | WildmatchFlags::CASEFOLD,
        ),
        ("pathmatch", WildmatchFlags::empty()),
        ("ipathmatch", WildmatchFlags::CASEFOLD),
    ];
    let mut checked = 0usize;
    for &(wm, iwm, pm, ipm, text, pattern) in T3070_CASES {
        for ((name, flags), expect) in modes.iter().zip([wm, iwm, pm, ipm]) {
            assert_eq!(
                wildmatch(pattern, text, *flags),
                expect == 1,
                "{name}: text {:?} pattern {:?}",
                BStr::new(text),
                BStr::new(pattern),
            );
            checked += 1;
        }
    }
    assert_eq!(checked, T3070_CASES.len() * 4);
}

/// t3070-wildmatch.sh "matching does not exhibit exponential behavior": git
/// runs this with a 2s timeout; the iterative matcher is O(n*m).
#[test]
fn t3070_no_exponential_behavior() {
    let text = b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";
    let pattern = b"*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a";
    assert!(!wildmatch(pattern, text, WildmatchFlags::PATHNAME));
}
