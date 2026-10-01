// Prints what upstream's stringutil functions (and the Go library functions beside them) answer.
// usage: vecstringutil <out dir>
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"hash/fnv"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"golden/stringutil"
)

func h(s string) string { return hex.EncodeToString([]byte(s)) }

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

var texts = []string{
	"", "a", "abc", "ABC", "Hello World", "a\nb", "a\r\nb", "a\rb", "a\n", "\n", "\r\n\r\n", "a\r", "\r", "line1\nline2\r\nline3\rline4",
	"  a\n    b\n  c", "\ta\n\t\tb", "a\n  b", "\n\n  x", " \u00a0a\n \u00a0 b", "\u2028a\u2029b", "  \n  a", "    x\n\n    y",
	"'a'", "\"a\"", "`a`", "'a\"", "''", "'", "\"\"", "'\\''", "\"a\\nb\"", "\"a\\\\b\"", "\"a\\\nb\"", "a\\", "\\", "\\\\", "'\\u0041'", "\"\\\xff\"", "'\u00e9'", "\u00e9a\u00e9",
	"\xef\xbb\xbfabc", "\xfe\xffab", "\xff\xfeab", "\xef\xbbab", "\xfe", "\xff", "\xef",
	"http://a b/c?d=e&f#g", "\u00e9\u4e2d\U0001F600", "-_.!~*'()", ";/?:@&=+$,#", "%20<>\"{}|\\^`[]", "\x00\x7f\x80\xff",
	"Abc", "\u00c9cole", "\u0130x", "\u01c5x", "\xffabc", "\U00010400x", "\u03a3x",
	"\xed\xa0\xbd", "\xed\xb8\x80", "\xed\xa0\xbd\xed\xb8\x80", "a\xed\xa0\xbd\xed\xb8\x80b", "\xed\xa0\xbdx\xed\xb8\x80", "\xed\xb8\x80\xed\xa0\xbd", "\xed\xa0\xbd\xed\xa0\xbd\xed\xb8\x80",
	"\xed\x9f\xbf", "\xed\xa0", "\xed", "x\xed\xa0\xbd", "\xed\xa0\xbd\xed\xb8", "\xf0\x9f\x98\x80", "\xc3", "\xe2\x82", "a\xc3", "\xe2\x82\xac", "\x80", "\xc0\x80", "\xf4\x90\x80\x80", "abc\x80\x80\x80\x80\x80",
	"\u00df", "STRASSE", "\u212a", "\ufb01", "\u0131I\u0130i", "\u03a9", "\u2126",
}

func main() {
	dir := os.Args[1]
	f, err := os.Create(dir + "/util.tsv")
	if err != nil {
		panic(err)
	}
	w := bufio.NewWriter(f)
	for _, s := range texts {
		lines := stringutil.SplitLines(s)
		hs := make([]string, len(lines))
		for i, l := range lines {
			hs[i] = h(l)
		}
		fmt.Fprintf(w, "SplitLines\t%s\t%s\n", h(s), strings.Join(hs, ","))
		fmt.Fprintf(w, "GuessIndentation\t%s\t%d\n", h(s), stringutil.GuessIndentation(lines))
		fmt.Fprintf(w, "EncodeURI\t%s\t%s\n", h(s), h(stringutil.EncodeURI(s)))
		fmt.Fprintf(w, "RemoveByteOrderMark\t%s\t%s\n", h(s), h(stringutil.RemoveByteOrderMark(s)))
		fmt.Fprintf(w, "AddUTF8ByteOrderMark\t%s\t%s\n", h(s), h(stringutil.AddUTF8ByteOrderMark(s)))
		fmt.Fprintf(w, "StripQuotes\t%s\t%s\n", h(s), h(stringutil.StripQuotes(s)))
		fmt.Fprintf(w, "UnquoteString\t%s\t%s\n", h(s), h(stringutil.UnquoteString(s)))
		fmt.Fprintf(w, "LowerFirstChar\t%s\t%s\n", h(s), h(stringutil.LowerFirstChar(s)))
		for _, n := range []int{-1, 0, 1, 2, 3, 5, 100} {
			fmt.Fprintf(w, "TruncateByRunes\t%s\t%d\t%s\n", h(s), n, h(stringutil.TruncateByRunes(s, n)))
		}
		fmt.Fprintf(w, "CombineSurrogatePairs\t%s\t%s\n", h(s), h(stringutil.CombineSurrogatePairs(s)))
		r, size := stringutil.DecodeJSStringRune(s)
		fmt.Fprintf(w, "DecodeJSStringRune\t%s\t%x,%d\n", h(s), r, size)
		r, size = utf8.DecodeLastRuneInString(s)
		fmt.Fprintf(w, "DecodeLastRune\t%s\t%x,%d\n", h(s), r, size)
		fmt.Fprintf(w, "RuneCount\t%s\t%d\n", h(s), utf8.RuneCountInString(s))
		fmt.Fprintf(w, "ToLower\t%s\t%s\n", h(s), h(strings.ToLower(s)))
	}
	for _, r := range []rune{0, 0x41, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffd, 0xffff, 0x10000, 0x1f600, 0x10ffff, 0x110000} {
		fmt.Fprintf(w, "EncodeJSStringRune\t%x\t%s\n", r, h(stringutil.EncodeJSStringRune(r)))
		high, low := stringutil.CodePointToSurrogatePair(r)
		fmt.Fprintf(w, "Surrogate\t%x\t%d%d%d,%x,%x,%x\n", r, b2i(stringutil.IsSurrogate(r)), b2i(stringutil.IsHighSurrogate(r)), b2i(stringutil.IsLowSurrogate(r)), high, low, stringutil.SurrogatePairToCodePoint(high, low))
	}
	w.Flush()
	f.Close()

	cmpStrings := []string{
		"", "a", "A", "b", "B", "ab", "AB", "Ab", "abc", "_", "Foo", "__String", "\u00e9", "\u00c9", "\u00df", "\u1e9e", "SS", "ss", "k", "K", "\u212a", "s", "\u017f",
		"\u0130", "i", "I", "\u0131", "\u03c3", "\u03c2", "\u03a3", "\xff", "\xfe", "a\xff", "A\xff", "\U00010400", "\U00010428", "path/To/File.TS", "PATH/to/file.ts", ".ts", ".TS", "file.ts", "\u01c4", "\u01c5", "\u01c6",
	}
	f, err = os.Create(dir + "/compare.tsv")
	if err != nil {
		panic(err)
	}
	w = bufio.NewWriter(f)
	for _, a := range cmpStrings {
		for _, b := range cmpStrings {
			fmt.Fprintf(w, "%s\t%s\t%d%d%d%d%d%d%d %d %d %d %d\n", h(a), h(b),
				b2i(stringutil.EquateStringCaseInsensitive(a, b)), b2i(stringutil.EquateStringCaseSensitive(a, b)),
				b2i(stringutil.HasPrefix(a, b, true)), b2i(stringutil.HasPrefix(a, b, false)),
				b2i(stringutil.HasSuffix(a, b, true)), b2i(stringutil.HasSuffix(a, b, false)),
				b2i(stringutil.HasPrefixAndSuffixWithoutOverlap(a, b, b, false)),
				stringutil.CompareStringsCaseInsensitive(a, b), stringutil.CompareStringsCaseSensitive(a, b),
				stringutil.CompareStringsCaseInsensitiveThenSensitive(a, b), stringutil.CompareStringsCaseInsensitiveEslintCompatible(a, b))
		}
	}
	w.Flush()
	f.Close()

	caseStrings := append([]string{
		"\u03a3", "\u0391\u03a3", "\u0391\u03a3\u0391", "\u0391\u03a3 ", "\u0391\u03a3.", "\u0391.\u03a3", "\u0391\u03a3\u0301", "\u03a3\u0391", " \u03a3", "\u038c\u03a3\u039f\u03a3", "a\u03a3", "A\u03a3b", "\u0391\u03a3\u00ad\u0391", "\u0391\u00ad\u03a3", "\u0391\u03a3\xed\xa0\xbd", "\xed\xa0\xbd\u03a3", "\u0391\u03a3\xff", "1\u03a3", "\u02b0\u03a3", "\u0391\u03a3\u02b0",
		"\u0130", "I\u0307", "i\u0307", "\u0131", "\u00df", "\u1e9e", "\ufb01\ufb02", "\u0149", "\u01f0", "\u0390", "\u1f80", "\u1fb7", "\u01c5", "\U00010400\U00010428", "\u212a\u212b\u2126", "\u00b5", "\u017f", "\u1c88", "\ua7d3", "\u019b", "\u0264",
		"Hello, W\u00f6rld!", "\u4e2d\u6587ABCabc", "\U0001F600A", "MiXeD \u00c4\u00e4 \u03a9\u03c9",
	}, texts...)
	f, err = os.Create(dir + "/js_case.tsv")
	if err != nil {
		panic(err)
	}
	w = bufio.NewWriter(f)
	for _, s := range caseStrings {
		fmt.Fprintf(w, "%s\t%s\t%s\n", h(s), h(stringutil.ToLowerJS(s)), h(stringutil.ToUpperJS(s)))
	}
	w.Flush()
	f.Close()

	digest := fnv.New64a()
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		bits := b2i(stringutil.IsWhiteSpaceLike(r)) | b2i(stringutil.IsWhiteSpaceSingleLine(r))<<1 | b2i(stringutil.IsLineBreak(r))<<2 | b2i(stringutil.IsDigit(r))<<3 |
			b2i(stringutil.IsOctalDigit(r))<<4 | b2i(stringutil.IsHexDigit(r))<<5 | b2i(stringutil.IsASCIILetter(r))<<6 | b2i(unicode.Is(unicode.Zs, r))<<7
		l, u, fo := unicode.ToLower(r), unicode.ToUpper(r), unicode.SimpleFold(r)
		if bits == 0 && l == r && u == r && fo == r {
			continue
		}
		fmt.Fprintf(digest, "%x %x %x %x %x\n", r, bits, l, u, fo)
	}
	fmt.Printf("rune digest 0x%016x\n", digest.Sum64())
	digest = fnv.New64a()
	lines := 0
	for cp := rune(0); cp <= 0x10FFFF; cp++ {
		if cp >= 0xD800 && cp <= 0xDFFF {
			continue
		}
		s := string(cp)
		lo, up := stringutil.ToLowerJS(s), stringutil.ToUpperJS(s)
		idb := 0
		if stringutil.IsUnicodeIdentifierStart(cp) {
			idb |= 1
		}
		if stringutil.IsUnicodeIdentifierPart(cp) {
			idb |= 2
		}
		if lo != s || up != s || idb != 0 {
			fmt.Fprintf(digest, "C\t%x\t%s\t%s\t%d\n", cp, h(lo), h(up), idb)
			lines++
		}
	}
	fmt.Printf("code point digest 0x%016x lines %d\n", digest.Sum64(), lines)
}
