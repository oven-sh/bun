// Ground truth of the bottom layer of the conformance runner: Go's own results, one JSON object per line.
// usage: gt <output file>
package main

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"gt/stringutil"
	"gt/tspath"
)

var out *bufio.Writer

func emit(v map[string]any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	out.Write(b)
	out.WriteByte('\n')
}

// A fixed generator: the vectors are the same on every run.
var seed uint64 = 0x9E3779B97F4A7C15

func rnd(n int) int {
	seed ^= seed << 13
	seed ^= seed >> 7
	seed ^= seed << 17
	return int(seed % uint64(n))
}

func hx(s string) string { return hex.EncodeToString([]byte(s)) }

func guard(f func() any) (result any) {
	defer func() {
		if r := recover(); r != nil {
			result = map[string]any{"panic": fmt.Sprint(r)}
		}
	}()
	return f()
}

var letters = []rune{
	'a', 'A', 'k', 'K', 's', 'S', 'z', 'Z', 'i', 'I', '_', '0', '9', '.', '-',
	0xDF, 0x130, 0x131, 0x17F, 0x212A, 0x3A3, 0x3C3, 0x3C2, 0x1C4, 0x1C5, 0x1C6, 0x1E9E, 0xE9, 0xC9, 0x4E2D,
	0xFFFD, 0xE000, 0xFFFF, 0x10400, 0x10428, 0x1F600, 0x10FFFF, 0x10000,
	// cased since Unicode 16 and 17: Go 1.26 (Unicode 15) leaves them alone
	0x10D50, 0x10D70, 0xA7CB, 0x264, 0x1C89, 0x1C8A, 0x16EA0, 0x16EBB, 0xA7DC, 0x19B,
	// cased since Unicode 13 and 14
	0x2C2F, 0x2C5F, 0xA7C0, 0xA7C1, 0x10570, 0x10597, 0xA7C7, 0xA7C8,
	0x1E900, 0x1E922, 0x3B9, 0x345, 0x1FBE, 0x399, 0xB5, 0x3BC, 0x39C,
}

var spaces = []rune{' ', '\t', '\n', '\r', '\v', '\f', 0x85, 0xA0, 0x1680, 0x2000, 0x200A, 0x200B, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF, 0x180E, 0x1C, 0x1F, 0}

func randString(pool []rune, maxLen int) string {
	n := rnd(maxLen + 1)
	var b strings.Builder
	for range n {
		b.WriteRune(pool[rnd(len(pool))])
	}
	return b.String()
}

func foldMate(r rune) rune {
	for range rnd(4) {
		r = unicode.SimpleFold(r)
	}
	return r
}

func tables() {
	emit(map[string]any{"s": "meta", "go": runtime.Version(), "unicode": unicode.Version})
	var lower, upper, title, fold, space, wssl, lb, fileLower []int
	strLowerBad := 0
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if l := unicode.ToLower(r); l != r {
			lower = append(lower, int(r), int(l))
		}
		if u := unicode.ToUpper(r); u != r {
			upper = append(upper, int(r), int(u))
		}
		if t := unicode.ToTitle(r); t != r {
			title = append(title, int(r), int(t))
		}
		if f := unicode.SimpleFold(r); f != r {
			fold = append(fold, int(r), int(f))
		}
		if unicode.IsSpace(r) {
			space = append(space, int(r))
		}
		if stringutil.IsWhiteSpaceSingleLine(r) {
			wssl = append(wssl, int(r))
		}
		if stringutil.IsLineBreak(r) {
			lb = append(lb, int(r))
		}
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		s := string(r)
		if strings.ToLower(s) != string(unicode.ToLower(r)) {
			strLowerBad++
		}
		// Behind one letter that is not ASCII, so that the general path runs for every rune.
		got := tspath.ToFileNameLowerCase("\u00e9" + s)
		got = got[2:]
		g, size := utf8.DecodeRuneInString(got)
		if size != len(got) {
			panic("ToFileNameLowerCase gave more than one rune")
		}
		if g != r {
			fileLower = append(fileLower, int(r), int(g))
		}
		if a := tspath.ToFileNameLowerCase(s); r < 0x80 && a != string(unicode.ToLower(r)) {
			panic("ToFileNameLowerCase on ASCII")
		}
	}
	emit(map[string]any{"s": "tolower", "pairs": lower})
	emit(map[string]any{"s": "toupper", "pairs": upper})
	emit(map[string]any{"s": "totitle", "pairs": title})
	emit(map[string]any{"s": "simplefold", "pairs": fold})
	emit(map[string]any{"s": "isspace", "runes": space})
	emit(map[string]any{"s": "wssl", "runes": wssl})
	emit(map[string]any{"s": "linebreak", "runes": lb})
	emit(map[string]any{"s": "filenamelower", "pairs": fileLower})
	emit(map[string]any{"s": "strtolower", "runesWhereStringsToLowerIsNotUnicodeToLower": strLowerBad})
}

func stringVectors() {
	pool := append(append([]rune{}, letters...), '/', '\\', ':', ' ')
	var cases []any
	for range 30000 {
		a := randString(pool, 6)
		var b string
		switch rnd(4) {
		case 0:
			b = randString(pool, 6)
		default:
			var sb strings.Builder
			for _, r := range a {
				if rnd(8) == 0 {
					sb.WriteRune(pool[rnd(len(pool))])
				} else {
					sb.WriteRune(foldMate(r))
				}
			}
			if rnd(10) == 0 {
				sb.WriteRune(pool[rnd(len(pool))])
			}
			b = sb.String()
		}
		cases = append(cases, []any{a, b, strings.EqualFold(a, b), stringutil.CompareStringsCaseInsensitive(a, b), strings.Compare(a, b),
			stringutil.HasPrefix(a, b, false), stringutil.HasSuffix(a, b, false)})
	}
	emit(map[string]any{"s": "pairs", "fields": "a b equalFold compareStringsCaseInsensitive compare hasPrefixIgnoreCase hasSuffixIgnoreCase", "cases": cases})

	both := append(append([]rune{}, letters...), spaces...)
	var trims []any
	for range 8000 {
		s := randString(spaces, 3) + randString(both, 5) + randString(spaces, 3)
		trims = append(trims, []any{s, strings.TrimSpace(s), strings.TrimRightFunc(s, unicode.IsSpace), strings.ToLower(s), tspath.ToFileNameLowerCase(s),
			strings.TrimSuffix(strings.TrimSpace(s), ";"), strings.TrimFunc(s, stringutil.IsWhiteSpaceLike), strings.TrimPrefix(s, " ")})
	}
	emit(map[string]any{"s": "strings", "fields": "s trimSpace trimRightSpace toLower toFileNameLowerCase trimSuffix trimFuncIsWhiteSpaceLike trimPrefixSpace", "cases": trims})
}

func decodeAll(prefix string, tails [][]byte) {
	var flat []int
	var rec func(s []byte, k int)
	rec = func(s []byte, k int) {
		if k == len(tails) {
			r, n := utf8.DecodeRuneInString(string(s))
			lr, ln := utf8.DecodeLastRuneInString(string(s))
			flat = append(flat, int(r), n, int(lr), ln)
			return
		}
		for _, b := range tails[k] {
			rec(append(s, b), k+1)
		}
	}
	rec(nil, 0)
	emit(map[string]any{"s": prefix, "flat": flat})
}

func allBytes(lo, hi int) []byte {
	var b []byte
	for i := lo; i <= hi; i++ {
		b = append(b, byte(i))
	}
	return b
}

func byteFacts(s string) map[string]any {
	var last []int
	for i := 0; i <= len(s); i++ {
		r, n := utf8.DecodeLastRuneInString(s[:i])
		last = append(last, int(r), n)
	}
	var first []int
	for i := 0; i <= len(s); i++ {
		r, n := utf8.DecodeRuneInString(s[i:])
		first = append(first, int(r), n)
	}
	starts := []int{}
	for _, p := range ComputeECMALineStarts(s) {
		starts = append(starts, int(p))
	}
	hexes := func(xs []string) []string {
		o := []string{}
		for _, x := range xs {
			o = append(o, hx(x))
		}
		return o
	}
	return map[string]any{
		"in": hx(s), "runeCount": utf8.RuneCountInString(s), "valid": utf8.ValidString(s), "utf16Len": int(UTF16Len(s)),
		"lineStarts": starts, "blank": hx(nonWhitespace.ReplaceAllString(s, " ")), "trimRight": hx(strings.TrimRightFunc(s, unicode.IsSpace)),
		"trimSpace": hx(strings.TrimSpace(s)), "splitLines": hexes(stringutil.SplitLines(s)), "lineDelimiterSplit": hexes(lineDelimiter.Split(s, -1)),
		"first": first, "last": last,
	}
}

var pieces = []string{
	"a", "Z", " ", "\t", "\n", "\r", "\r\n", "\v", "\f", "~", "/", "*", "\u0085", "\u00a0", "\u00e9", "\u1680", "\u2028", "\u2029", "\u3000", "\ufeff",
	"\u200b", "\u4e2d", "\U0001F600", "\U00010400", "\xff", "\xc3", "\xe2\x80", "\xf0\x9f\x98", "\x80", "\xed\xa0\x80", "\xc0\xaf", "\xf4\x90\x80\x80", "\ufffd", "\x00",
}

func randBytes(maxPieces int) string {
	var b strings.Builder
	for range rnd(maxPieces + 1) {
		b.WriteString(pieces[rnd(len(pieces))])
	}
	return b.String()
}

func byteVectors() {
	decodeAll("utf8-1", [][]byte{allBytes(0, 255)})
	decodeAll("utf8-2", [][]byte{allBytes(0, 255), allBytes(0, 255)})
	decodeAll("utf8-3", [][]byte{allBytes(0xE0, 0xEF), allBytes(0, 255), {0x00, 0x7F, 0x80, 0xBF, 0xC0, 0xFF}})
	decodeAll("utf8-4", [][]byte{allBytes(0xF0, 0xF7), allBytes(0, 255), {0x7F, 0x80, 0xBF, 0xC0}, {0x7F, 0x80, 0xBF, 0xC0}})
	var cases []any
	for _, p := range pieces {
		cases = append(cases, byteFacts(p))
	}
	for range 6000 {
		cases = append(cases, byteFacts(randBytes(8)))
	}
	emit(map[string]any{"s": "bytes", "cases": cases})
}

var triviaTexts = []string{
	"", " ", "a", "  a", "\t\v\f x", "\r\n\r\n  x", "\n\r x", "// c\nx", "// c", "// c\r\nx", "// c\u2028x", "// c\u2029x", "//\u00e9\nx",
	"/* c */x", "/* c", "/* \u00e9\U0001F600 */ x", "/*/ x", "/**/x", "/ x", "/", "//", "/*", "*/x", "* x", "\u00a0x", "\u0085x", "\u1680x", "\u2000\u200a\u200bx",
	"\u2028x", "\u2029x", "\u202fx", "\u205fx", "\u3000x", "\ufeffx", "\u180ex", "\u200cx", "#!/bin/sh\nx", "#!/bin/sh", "#!", "#", " #!/bin/sh\nx", "#!a\u2028x",
	"<<<<<<< HEAD\nx", "<<<<<<<HEAD\nx", "<<<<<<< ", "<<<<<<<", "<<<<<< x", "=======\nx", "======= \nx", "=======", "========x", ">>>>>>> b\nx", "|||||||\nx", "||||||| base\nx\n=======\ny",
	"a\n<<<<<<< HEAD\nx", "a\r<<<<<<< HEAD\nx", "a\u2028<<<<<<< HEAD\nx", "a <<<<<<< HEAD\nx", "\n\n=======\nx\n>>>>>>> b\ny", "x\n=======\ny\n======= z\n>>>>>>> w\nv",
	"=======\nabc\n>>>>>>>\nz", "||||||| x\n======\n>>>>>>> y\n", "a\n\xff=======\nx", "\xff\xfe x", "\xe2\x80x", " \xc3", "// \xff\nx", "/* \xf0\x9f */x", "\xed\xa0\x80 x",
	"  // one\n  /* two */\n\t// three\r\n x // four", "<", "=", ">", "|", "<<", "==\n", "=>", "\r", "\n", "\r\n",
}

func triviaVectors() {
	var cases []any
	for _, text := range triviaTexts {
		var res []int
		for pos := -1; pos <= len(text)+1; pos++ {
			res = append(res, SkipTrivia(text, pos))
		}
		cases = append(cases, map[string]any{"in": hx(text), "from": -1, "results": res})
	}
	for range 3000 {
		text := randBytes(3) + triviaTexts[rnd(len(triviaTexts))] + randBytes(3) + triviaTexts[rnd(len(triviaTexts))]
		var res []int
		for pos := -1; pos <= len(text)+1; pos++ {
			res = append(res, SkipTrivia(text, pos))
		}
		cases = append(cases, map[string]any{"in": hx(text), "from": -1, "results": res})
	}
	emit(map[string]any{"s": "skiptrivia", "cases": cases})
}

func lineVectors() {
	texts := []string{"", "a", "a\n", "a\nb", "a\r\nb\r\n", "a\rb", "\n\n", "\u00e9\U0001F600x\ny", "a\u2028b\u2029c", "\U0001F600\U0001F600", "x\xffy\nz", "\xe2\x80\n\xf0", "ab\u4e2dcd\r\n\u00e9"}
	for range 60 {
		texts = append(texts, randBytes(10))
	}
	var cases []any
	for _, text := range texts {
		starts := ComputeECMALineStarts(text)
		var lineOf []int
		for pos := -2; pos <= len(text)+2; pos++ {
			lineOf = append(lineOf, ComputeLineOfPosition(starts, pos))
		}
		var posOf []any
		for line := -1; line <= len(starts); line++ {
			for ch := 0; ch <= 12; ch++ {
				posOf = append(posOf, guard(func() any {
					return ComputePositionOfLineAndUTF16Character(starts, line, UTF16Offset(ch), text, false)
				}))
			}
		}
		var lineAndOffset []int
		for pos := 0; pos <= len(text); pos++ {
			l, o := PositionToLineAndByteOffset(pos, starts)
			lineAndOffset = append(lineAndOffset, l, o)
		}
		var lineAndChar []int
		for pos := 0; pos <= len(text); pos++ {
			l := ComputeLineOfPosition(starts, pos)
			lineAndChar = append(lineAndChar, l, int(UTF16Len(text[starts[l]:pos])))
		}
		ints := []int{}
		for _, p := range starts {
			ints = append(ints, int(p))
		}
		cases = append(cases, map[string]any{"in": hx(text), "lineStarts": ints, "lineOfFromMinus2": lineOf, "positionOfLineFromMinus1Char0To12": posOf,
			"lineAndByteOffset": lineAndOffset, "lineAndUTF16Character": lineAndChar})
	}
	emit(map[string]any{"s": "lines", "cases": cases})
}

func decodeVectors() {
	inputs := []string{
		"", "a", "\xef\xbb\xbfa", "\xef\xbb\xbf", "\xef\xbb", "\xef", "\xff\xfe", "\xfe\xff", "\xff\xfea\x00", "\xfe\xff\x00a", "\xff\xfea\x00b", "\xfe\xff\x00a\x00",
		"\xff\xfe\x3d\xd8\x00\xde", "\xfe\xff\xd8\x3d\xde\x00", "\xff\xfe\x00\xd8", "\xff\xfe\x00\xdc\x00\xd8", "\xfe\xff\xdc\x00", "\xff\xfe\xff\xfe", "\xff\xfe\xff\xfea\x00",
		"\xef\xbb\xbf\xef\xbb\xbfa", "\xff", "\xfe", "\xff\xff", "\xfe\xfe", "a\xef\xbb\xbf", "\xc3\x28", "\xef\xbb\xbf\xff", "\xff\xfe\x28\x20\x29\x20a\x00",
		"\xfe\xff\x20\x28\x00\x0d\x00\x0a", "\xff\xfe\x0d\x00\x0a\x00", "\x00", "\xff\xfe\xfd\xff", "\xff\xfe\xff\xff", "\xff\xfe\x00\x00",
	}
	for range 400 {
		inputs = append(inputs, randBytes(6))
		inputs = append(inputs, []string{"\xff\xfe", "\xfe\xff", "\xef\xbb\xbf"}[rnd(3)]+randBytes(6))
	}
	var cases []any
	for _, s := range inputs {
		got, ok := decodeBytes(s)
		cases = append(cases, []any{hx(s), hx(got), ok})
	}
	emit(map[string]any{"s": "decodeBytes", "fields": "in out ok", "cases": cases})
}

var names = []string{
	"", "/", "//", "a", "a.ts", "A.TS", "/a/b.ts", "/A/B.ts", "/a/./b.ts", "/a/../b.ts", "/a/b/", "c:/", "C:/", "c:/a", "C:\\A", "c:", "^/untitled/ts-nul/a", "file:///c:/a.ts", "file:///C%3A/a.ts",
	"http://host/a", "HTTP://HOST/a", "//server/share/a", "//SERVER/share/a", "./a", "../a", "a/..", ".", "..", "/.src/a.ts", "/.SRC/a.ts", "/.lib/lib.d.ts", "bundled:///libs/lib.d.ts",
	"/\u00e9.ts", "/\u00c9.ts", "/e\u0301.ts", "/\u0130.ts", "/i\u0307.ts", "/i.ts", "/I.ts", "/\u0131.ts", "/\u212a.ts", "/k.ts", "/K.ts", "/\u017f.ts", "/s.ts", "/\u00df.ts", "/SS.ts", "/ss.ts",
	"/\u03a3.ts", "/\u03c3.ts", "/\u03c2.ts", "/\U00010400.ts", "/\U00010428.ts", "/\ue000.ts", "/\uffff.ts", "/\U0001F600.ts", "/\u4e2d/\u6587.d.ts", "/\ua7cb.ts", "/\u0264.ts",
	"/\U00010d50.ts", "/\U00010d70.ts", "/a.d.ts", "/a.D.TS", "/a.json", "/a.tsx", "/a.\u017f", "/a.tS", "/a.mts", "/a.d.mts", "/a.cjs", "/dir.ts/", "/a b/c d.ts", "/a/b/c", "/a/b", "/a/bc",
	"x:/y", "X:/Y", "x:/y/../z", "/x/y/../../..", "a\\b", "\\\\server\\share", "/a//b", "/a/b/./", "http://\u00e9/a", "http://\u00c9/a",
}

func cmp3(x int) int {
	if x < 0 {
		return -1
	}
	if x > 0 {
		return 1
	}
	return 0
}

func pathVectors() {
	var single []any
	exts := []string{".TS", ".d.ts", "json"}
	for _, a := range names {
		single = append(single, []any{
			a, tspath.PathIsAbsolute(a), tspath.IsRootedDiskPath(a), tspath.GetRootLength(a), tspath.GetEncodedRootLength(a), tspath.ToFileNameLowerCase(a),
			tspath.GetCanonicalFileName(a, false), tspath.GetCanonicalFileName(a, true), tspath.HasExtension(a), tspath.GetAnyExtensionFromPath(a, nil, false),
			tspath.GetAnyExtensionFromPath(a, exts, false), tspath.GetAnyExtensionFromPath(a, exts, true), tspath.GetBaseFileName(a), tspath.GetDirectoryPath(a),
			tspath.NormalizePath(a), tspath.NormalizeSlashes(a), tspath.RemoveTrailingDirectorySeparator(a), tspath.EnsureTrailingDirectorySeparator(a),
			tspath.RemoveTrailingDirectorySeparators(a), tspath.HasTrailingDirectorySeparator(a), tspath.ChangeExtension(a, ".js"), tspath.ChangeAnyExtension(a, "x", exts, true),
			tspath.FileExtensionIs(a, ".ts"), tspath.FileExtensionIsOneOf(a, []string{".d.ts", ".json"}), tspath.GetPathComponents(a, ""), tspath.GetPathFromPathComponents(tspath.GetPathComponents(a, "")),
			tspath.ReducePathComponents(tspath.GetPathComponents(a, "")), tspath.GetNormalizedPathComponents(a, "/cur"),
		})
	}
	emit(map[string]any{"s": "path1", "fields": "a pathIsAbsolute isRootedDiskPath getRootLength getEncodedRootLength toFileNameLowerCase getCanonicalFileName(false) getCanonicalFileName(true) hasExtension getAnyExtensionFromPath getAnyExtensionFromPathEx(exts,false) getAnyExtensionFromPathEx(exts,true) getBaseFileName getDirectoryPath normalizePath normalizeSlashes removeTrailingDirectorySeparator ensureTrailingDirectorySeparator removeTrailingDirectorySeparators hasTrailingDirectorySeparator changeExtension(.js) changeAnyExtension(x,exts,true) fileExtensionIs(.ts) fileExtensionIsOneOf getPathComponents getPathFromPathComponents reducePathComponents getNormalizedPathComponents(/cur)", "cases": single})
	var pairs []any
	for _, a := range names {
		for _, b := range names {
			cs := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true}
			ci := tspath.ComparePathsOptions{}
			csCur := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true, CurrentDirectory: "/cur"}
			relCs := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true, CurrentDirectory: b}
			relCi := tspath.ComparePathsOptions{CurrentDirectory: b}
			pairs = append(pairs, []any{
				a, b, cmp3(tspath.ComparePaths(a, b, cs)), cmp3(tspath.ComparePaths(a, b, ci)), cmp3(tspath.ComparePaths(a, b, csCur)),
				tspath.ContainsPath(a, b, cs), tspath.ContainsPath(a, b, ci), tspath.ConvertToRelativePath(a, relCs), tspath.ConvertToRelativePath(a, relCi),
				tspath.CombinePaths(a, b), tspath.GetNormalizedAbsolutePath(a, b), string(tspath.ToPath(a, b, true)), string(tspath.ToPath(a, b, false)),
				tspath.GetPathComponentsRelativeTo(a, b, ci), tspath.GetPathComponents(a, b),
			})
		}
	}
	emit(map[string]any{"s": "path2", "fields": "a b comparePaths(cs) comparePaths(ci) comparePaths(cs,/cur) containsPath(cs) containsPath(ci) convertToRelativePath(a,{cwd:b,cs}) convertToRelativePath(a,{cwd:b,ci}) combinePaths getNormalizedAbsolutePath toPath(true) toPath(false) getPathComponentsRelativeTo(ci) getPathComponents", "cases": pairs})
}

func regexpVectors() {
	classes := map[string]*regexp.Regexp{
		"space": regexp.MustCompile(`^\s$`), "S": regexp.MustCompile(`^\S$`), "w": regexp.MustCompile(`^\w$`), "d": regexp.MustCompile(`^\d$`),
		"dot": regexp.MustCompile(`^.$`), "is": regexp.MustCompile(`(?i)^s$`), "ik": regexp.MustCompile(`(?i)^k$`), "ii": regexp.MustCompile(`(?i)^i$`),
		"ilibdt": regexp.MustCompile(`(?i)^[libdt]$`),
	}
	res := map[string]any{"s": "re2classes"}
	for name, re := range classes {
		var hit []int
		for r := rune(0); r <= unicode.MaxRune; r++ {
			if r >= 0xD800 && r <= 0xDFFF {
				continue
			}
			if re.MatchString(string(r)) {
				hit = append(hit, int(r))
			}
		}
		if name == "S" || name == "dot" {
			// The complement is short: every scalar value but these.
			var miss []int
			for r := rune(0); r <= unicode.MaxRune; r++ {
				if r >= 0xD800 && r <= 0xDFFF {
					continue
				}
				if !re.MatchString(string(r)) {
					miss = append(miss, int(r))
				}
			}
			res["not_"+name] = miss
			continue
		}
		res[name] = hit
	}
	emit(res)
	text := "a\nb\rc\u2028d\u2029e\r\nf\n"
	anchors := map[string]any{"s": "re2anchors", "text": text}
	for name, pattern := range map[string]string{"mstart": `(?m)^`, "mend": `(?m)$`, "start": `^`, "end": `$`} {
		var at []int
		for _, m := range regexp.MustCompile(pattern).FindAllStringIndex(text, -1) {
			at = append(at, m[0])
		}
		anchors[name] = at
	}
	emit(anchors)
	lines := []string{
		"// @strict: true", "//@a:b", "//\t@a\f:\r b", "//\v@a: b", "//\u00a0@a: b", "// @\u017f: b", "// @a\u212a: b", "// @link: /a -> /b", "// @link : a->b -> c",
		"// @link: a \u00a0->\u00a0 b", "x\n// @a: 1\r\n// @b: 2\r// @c: 3\u2028// @d: 4", "// @a:\n// @b: 1", "/// @a: b", " // @a: b", "// @a: b // @c: d", "// @A_1: \u00e9\U0001F600 ;",
		"reference path", "reference\tpath", "reference\u00a0path", "reference\vpath", "reference\npath", "a.ts", "a.tsx", "a.ts\n", "a.TS", "a.d.ts",
	}
	var cases []any
	for _, l := range lines {
		cases = append(cases, []any{l, optionRegex.FindAllStringSubmatch(l, -1), linkRegex.FindStringSubmatch(l), referencesRegex.MatchString(l), compilerBaselineRegex.MatchString(l)})
	}
	emit(map[string]any{"s": "regexps", "fields": "line optionRegex.FindAllStringSubmatch linkRegex.FindStringSubmatch referencesRegex.MatchString compilerBaselineRegex.MatchString", "cases": cases})
}

func libLocationVectors() {
	inputs := []string{
		"lib.d.ts(1,2): error TS1: x", "LIB.ES5.D.TS(10,20): error", "lib.d.t\u017f(1,1)", "lib.d.tS(3,4)", "a\nlib.d.ts(1,1)", "a\rlib.d.ts(1,1)", "a\r\nlib.d.ts(1,1)", "a\u2028lib.d.ts(1,1)",
		" lib.d.ts(1,1)", "lib.x\ny.d.ts(1,1)", "lib.x\ry.d.ts(1,1)", "lib.x\u2028y.d.ts(1,1)", "lib.d.ts(1,1) lib.d.ts(2,2)", "lib.d.ts(1,1)\nlib.dom.d.ts(2,2)\n", "l\u0131b.d.ts(1,1)", "l\u0130b.d.ts(1,1)",
		"lib.d.ts(\u0661,\u0662)", "lib.d.ts(1, 2)", "lib.d.ts(,)", "lib\u00e9\U0001F600.d.ts(7,8)", "lib\xff.d.ts(7,8)", "libd.ts(1,1)", "lib.d.tsx(1,1)", "\u212aib.d.ts(1,1)", "lib.d.t\u017f\u017f(1,1)",
		"lib.d.ts:1:2", "xlib.es5.d.ts:10:20 and lib.d.ts:3:4", "liB.D.TS:1:1", " lib.d.t\u017f:5:6", "lib.d.ts:--:--", "lib.a\nb.d.ts:1:1", "lib.a\rb.d.ts:1:1", "lib.d.ts:1:2:3:4", "lib.d.ts:\u0661:2", "lib\xff.d.ts:7:8",
		"", "lib", "\n", "lib.d.ts", "(1,1)",
	}
	var cases []any
	for _, s := range inputs {
		cases = append(cases, []any{hx(s), hx(diagnosticsLocationPrefix.ReplaceAllString(s, "$1(--,--)")), hx(diagnosticsLocationPattern.ReplaceAllString(s, "$1:--:--"))})
	}
	emit(map[string]any{"s": "libLocation", "fields": "in prefixReplaced patternReplaced", "cases": cases})
}

func atoiVectors() {
	inputs := []string{
		"", "0", "-0", "+0", "7", "+7", "-7", "007", "-007", "1_000", "0x10", "0b1", "0o7", "1e3", " 1", "1 ", "1\n", "\t1", "1.0", "1.", ".1", "+", "-", "--1", "+-1", "-+1", "++1",
		"\uff19", "\u0663", "1\u0663", "true", "NaN", "Infinity", "9007199254740991", "9007199254740992", "9007199254740993", "9223372036854775807", "9223372036854775808",
		"-9223372036854775808", "-9223372036854775809", "+9223372036854775807", "12345678901234567890", "00000000000000000000001", "-00000000000000000000000000", "1a", "a1", "0,1",
	}
	for range 400 {
		var b strings.Builder
		for range rnd(22) {
			b.WriteByte("0123456789+-_ x.e9"[rnd(18)])
		}
		inputs = append(inputs, b.String())
	}
	var cases []any
	for _, s := range inputs {
		n, err := strconv.Atoi(s)
		cases = append(cases, []any{s, strconv.Itoa(n), err == nil})
	}
	emit(map[string]any{"s": "atoi", "fields": "in value ok", "int": strconv.IntSize, "cases": cases})
}

func main() {
	f, err := os.Create(os.Args[1])
	if err != nil {
		panic(err)
	}
	out = bufio.NewWriterSize(f, 1<<20)
	tables()
	stringVectors()
	byteVectors()
	triviaVectors()
	lineVectors()
	decodeVectors()
	pathVectors()
	regexpVectors()
	libLocationVectors()
	atoiVectors()
	out.Flush()
	f.Close()
}
