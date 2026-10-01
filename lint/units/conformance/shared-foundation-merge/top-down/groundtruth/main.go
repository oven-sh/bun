// Ground truth of the shared foundation: Go's standard library and the reference's own tspath, stringutil, core and
// scanner functions on generated inputs. Every string of the output is base64 of its bytes.
// usage: gt tables <out.txt> | gt vectors <out.jsonl>
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"gt/stringutil"
	"gt/tspath"
)

// What the cut-out of scanner.go names in the diagnostics package.
type Message struct{}

var Merge_conflict_marker_encountered = &Message{}

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

var seed uint32 = 20250929

func rnd(n int) int {
	seed = seed*1664525 + 1013904223
	return int((uint64(seed) * uint64(n)) >> 32)
}

func pick(a []string) string { return a[rnd(len(a))] }

func tables(path string) {
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()
	fmt.Fprintln(w, "version", unicode.Version)
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if l := unicode.ToLower(r); l != r {
			fmt.Fprintf(w, "L %x %x\n", r, l)
		}
	}
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if u := unicode.ToUpper(r); u != r {
			fmt.Fprintf(w, "U %x %x\n", r, u)
		}
	}
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if n := unicode.SimpleFold(r); n != r {
			fmt.Fprintf(w, "F %x %x\n", r, n)
		}
	}
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if unicode.IsSpace(r) {
			fmt.Fprintf(w, "S %x\n", r)
		}
	}
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if stringutil.IsWhiteSpaceLike(r) {
			fmt.Fprintf(w, "W %x %v %v\n", r, stringutil.IsWhiteSpaceSingleLine(r), stringutil.IsLineBreak(r))
		}
	}
}

var nonWhitespace = regexp.MustCompile(`\S`)

type textRow struct {
	K          string   `json:"k"`
	S          string   `json:"s"`
	Valid      bool     `json:"valid"`
	RuneCount  int      `json:"rc"`
	UTF16Len   int      `json:"u16"`
	LineStarts []int    `json:"ls"`
	TrimRight  string   `json:"trimRight"`
	TrimSpace  string   `json:"trimSpace"`
	TrimWhite  string   `json:"trimWhite"`
	Blank      string   `json:"blank"`
	Skip       []int    `json:"skip"`
	LineChar   [][2]int `json:"lc"`
	Split      []string `json:"split"`
	SplitLines []string `json:"splitLines"`
	ToLower    string   `json:"toLower"`
	FileLower  string   `json:"toFileNameLowerCase"`
}

func b64s(a []string) []string {
	out := make([]string, len(a))
	for i, s := range a {
		out[i] = b64(s)
	}
	return out
}

func textRecord(s string) textRow {
	r := textRow{K: "text", S: b64(s)}
	r.Valid = utf8.ValidString(s)
	r.RuneCount = utf8.RuneCountInString(s)
	r.UTF16Len = int(UTF16Len(s))
	starts := ComputeECMALineStarts(s)
	for _, p := range starts {
		r.LineStarts = append(r.LineStarts, int(p))
	}
	r.TrimRight = b64(strings.TrimRightFunc(s, unicode.IsSpace))
	r.TrimSpace = b64(strings.TrimSpace(s))
	r.TrimWhite = b64(strings.TrimFunc(s, stringutil.IsWhiteSpaceLike))
	r.Blank = b64(nonWhitespace.ReplaceAllString(s, " "))
	for p := 0; p <= len(s); p++ {
		r.Skip = append(r.Skip, SkipTrivia(s, p))
		line := ComputeLineOfPosition(starts, p)
		r.LineChar = append(r.LineChar, [2]int{line, int(UTF16Len(s[starts[line]:p]))})
	}
	r.Split = b64s(lineDelimiter.Split(s, -1))
	r.SplitLines = b64s(stringutil.SplitLines(s))
	r.ToLower = b64(strings.ToLower(s))
	r.FileLower = b64(tspath.ToFileNameLowerCase(s))
	return r
}

var textAtoms = []string{
	"a", "b", "x", "Foo", "BAR", " ", " ", "  ", "\t", "\v", "\f", "(", ")", ";", "=", "~", "/", "*", "#", "!", "<", ">", "|",
	"//", "/*", "*/", "// c", "/* c */", "<<<<<<<", "=======", ">>>>>>>", "|||||||", "<<<<<<< ", ">>>>>>> ", "#!",
	"\u00a0", "\ufeff", "\u00e9", "\u4e2d", "\U0001F600", "\U00010000", "\u2028", "\u2029", "\u0085", "\u3000", "\u1680",
	"\u200b", "\u180e", "\u202f", "\u205f", "\u2000", "\u200a", "\u0130", "\u0131", "\u212a", "\u017f", "\u00df", "\u03a3", "\u03c2",
	"\u01c5", "\u1e9e", "\u1c89", "\ua7cb", "\ua7dc", "\U00010D50", "\U0001E900", "\u13a0", "\uab70", "\u1c90",
	"\xff", "\x80", "\xe2\x80", "\xf0\x9f", "\xc0\xaf", "\xed\xa0\x80", "\x00", "\xf4\x90\x80\x80", "\xef\xbb\xbf",
}

var textBreaks = []string{"\n", "\n", "\n", "\r\n", "\r\n", "\r", "\r\r\n", "\u2028", "\u2029", "\n\n", "\n\r"}

func genText() string {
	var b strings.Builder
	lines := rnd(6)
	for l := 0; l <= lines; l++ {
		n := rnd(7)
		for k := 0; k < n; k++ {
			b.WriteString(pick(textAtoms))
		}
		if l < lines || rnd(2) == 0 {
			b.WriteString(pick(textBreaks))
		}
	}
	return b.String()
}

var fixedTexts = []string{
	"", "a", "a\n", "a\rb", "a\r\nb", "\n", "\r", "\r\n", "\n\r", "a\u2028b\u2029c", "\ufeffa", " \t\v\f\u00a0\u0085x \t\v\f\u00a0\u0085",
	"// only a comment", "// c\ncode", "/* c */", "/* open", "/* a */ /* b */\n// c\n", "/", "/ /", "#!shebang\ncode", " #!not", "#",
	"<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n", "a\n<<<<<<< HEAD\n", "<<<<<<<x", "=======", "=======\n", "========", "||||||| base\nz\n=======\n",
	"\u2028<<<<<<< x\n", "\u00a0\n=======\nq", "x <<<<<<< y", "<<<<<<", ">>>>>>> ", ">>>>>>>\n", "a\xe2\x80\xa8=======\nb",
	"\u00e9\u4e2d\U0001F600", "\xff\xfe", "\xe2\x80", "a\xffb\n\xf0\x9f\x98", "\u0130\u0131I i", "K\u212ak", "S\u017fs", "\u03a3\u03c3\u03c2",
	"\u200b", "\u180e", "\ufeff", "\u0085", "\u00a0", "\u3000\u1680\u2000\u200a\u202f\u205f", "tab\there", "trail  \t\u00a0\u3000\u2028",
	"\x1c\x1d\x1e\x1f", "TSCONF\u0130G.JSON", "\u1c89\ua7cb\ua7dc\U00010D50", "\u01c5\u01c4\u01c6", "\u1e9e\u00df", "\u13a0\uab70\u1c90\u10d0",
}

type seqDigest struct {
	K      string `json:"k"`
	Set    string `json:"set"`
	Count  int    `json:"count"`
	Digest string `json:"digest"`
	Sum32  uint32 `json:"sum32"`
}

// The same facts as seqLine in a sum that costs no text: FNV-1a over 32-bit words.
func seqSum(h uint32, s string) uint32 {
	r, size := utf8.DecodeRuneInString(s)
	lr, lsize := utf8.DecodeLastRuneInString(s)
	valid := 0
	if utf8.ValidString(s) {
		valid = 1
	}
	for _, v := range []int{int(r), size, int(lr), lsize, utf8.RuneCountInString(s), valid, int(UTF16Len(s))} {
		h = (h ^ uint32(v)) * 16777619
	}
	return h
}

// One line per sequence: hex, rune and size of the first rune, rune and size of the last rune, rune count, validity, UTF-16 length.
func seqLine(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	lr, lsize := utf8.DecodeLastRuneInString(s)
	return fmt.Sprintf("%x %d %d %d %d %d %v %d\n", s, r, size, lr, lsize, utf8.RuneCountInString(s), utf8.ValidString(s), int(UTF16Len(s)))
}

var edge = []byte{0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc2, 0xe0, 0xed, 0xf0, 0xf4, 0xff}

func seqSets(emit func(any)) {
	digest := func(set string, gen func(yield func(string))) {
		h := sha256.New()
		sum := uint32(2166136261)
		n := 0
		gen(func(s string) {
			h.Write([]byte(seqLine(s)))
			sum = seqSum(sum, s)
			n++
		})
		emit(seqDigest{K: "seq", Set: set, Count: n, Digest: hex.EncodeToString(h.Sum(nil)), Sum32: sum})
	}
	digest("one", func(yield func(string)) {
		for a := 0; a < 256; a++ {
			yield(string([]byte{byte(a)}))
		}
	})
	for a := 0x80; a < 256; a += 16 {
		digest(fmt.Sprintf("two-%02x", a), func(yield func(string)) {
			for x := a; x < a+16; x++ {
				for b := 0; b < 256; b++ {
					yield(string([]byte{byte(x), byte(b)}))
				}
			}
		})
	}
	digest("three", func(yield func(string)) {
		for a := 0xe0; a <= 0xef; a++ {
			for _, b := range edge {
				for _, c := range edge {
					yield(string([]byte{byte(a), b, c}))
				}
			}
		}
	})
	digest("four", func(yield func(string)) {
		for a := 0xf0; a <= 0xf7; a++ {
			for _, b := range edge {
				for _, c := range edge {
					for _, d := range edge {
						yield(string([]byte{byte(a), b, c, d}))
					}
				}
			}
		}
	})
	digest("scalars", func(yield func(string)) {
		for r := rune(0); r <= unicode.MaxRune; r += 7 {
			if r >= 0xd800 && r <= 0xdfff {
				continue
			}
			yield("x" + string(r) + "y")
		}
	})
}

var pairStrings = []string{
	"", "a", "A", "b", "B", "ab", "AB", "aB", "abc", "a.ts", "A.TS", "z", "Z", "_", "[", "`", "{", "0", "9", " ",
	"\u00e9", "\u00c9", "e\u0301", "\u00df", "SS", "ss", "\u1e9e", "\u0130", "i", "I", "\u0131", "i\u0307", "K", "k", "\u212a",
	"S", "s", "\u017f", "\u03a3", "\u03c3", "\u03c2", "\u01c4", "\u01c5", "\u01c6", "\u00b5", "\u03bc", "\u039c", "\u00c5", "\u00e5", "\u212b",
	"\u1c89", "\u1c8a", "\ua7cb", "\u0264", "\ua7dc", "\u019b", "\ua7da", "\ua7db", "\ua7cc", "\ua7cd", "\U00010D50", "\U00010D70",
	"\U00010400", "\U00010428", "\U0001E900", "\U0001E922", "\u13a0", "\uab70", "\u1c90", "\u10d0", "\u2167", "\u2177", "\u24b6", "\u24d0",
	"\uffff", "\ue000", "\ud7ff", "\U00010000", "\U0010FFFF", "\uff21", "\uff41", "\u4e2d", "\u00ff", "\u0178", "\u1e60", "\u1e61", "\u1e9b",
	"\u0398", "\u03b8", "\u03d1", "\u03f4", "\u2126", "\u03a9", "\u03c9", "\u0345", "\u0399", "\u03b9", "\u1fbe", "\u0392", "\u03b2", "\u03d0",
	"a\u00e9", "A\u00c9", "a\U00010400", "A\U00010428", "x\uffff", "x\U00010000", "\u00e9a", "\u00e9b",
}

type pairRow struct {
	K    string `json:"k"`
	A    string `json:"a"`
	B    string `json:"b"`
	Fold bool   `json:"equalFold"`
	Cmp  int    `json:"compare"`
	CI   int    `json:"compareCaseInsensitive"`
	CS   int    `json:"compareCaseSensitive"`
}

var pathStrings = []string{
	"", ".", "..", "/", "//", "///", "a", "a/", "a/b", "a/b/", "./a", "../a", "a/./b", "a/../b", "a//b", "/a", "/a/", "/a/b", "/a/b/", "/a/./b", "/a/../b", "/..", "/../a",
	"/.src", "/.src/", "/.src/a.ts", "/.src/A.ts", "/.src/a.TS", "/.src/dir/a.ts", "/.src/dir/../a.ts", "/.src/./a.ts", "/.SRC/a.ts", "/.lib/lib.d.ts", "/.ts/lib.es5.d.ts",
	"c:", "c:/", "C:/", "c:\\", "c:/a", "C:/A", "c:a", "c:/a/../b", "d:/a", "\\\\server\\share", "//server/share", "//SERVER/share", "//server", "//server/",
	"file:///a/b", "file:///c:/a", "file:///C:/a", "file://localhost/c:/a", "file:///c%3a/a", "file:///c%3A/a", "http://host/a", "HTTP://host/a", "http://HOST/a", "http://host", "bundled:///libs/lib.d.ts",
	"^/untitled/ts-nul-authority/Untitled-1", "^/a", "^", "a.ts", "a.tsx", "a.d.ts", "a.js", "a.json", "a.d.mts", "a.tsbuildinfo", "a.", ".a", "a.b.c", "a/b.c/d", "tsconfig.json", "TSCONFIG.JSON", "jsconfig.json",
	"\u00e9.ts", "\u00c9.ts", "/.src/\u00e9.ts", "/.src/\u00c9.ts", "/.src/\u0130.ts", "/.src/i.ts", "/.src/I.ts", "/.src/\u0131.ts", "/.src/\u212a.ts", "/.src/k.ts", "/.src/K.ts",
	"/.src/\u017f.ts", "/.src/s.ts", "/.src/S.ts", "/.src/\u00df.ts", "/.src/SS.ts", "/.src/\u03a3.ts", "/.src/\u03c3.ts", "/.src/\u03c2.ts", "/.src/\U00010400.ts", "/.src/\U00010428.ts",
	"/.src/\uffff.ts", "/.src/\U00010000.ts", "/.src/\u4e2d/\u6587.ts", "/\u00e9/../\u00e9", "//s\u00e9rver/share/a", "//S\u00c9RVER/share/a", "http://h\u00f6st/a", "/.src/\u1c89.ts", "/.src/\u1c8a.ts", "/.src/\ua7dc.ts", "/.src/\u019b.ts",
	"/a b/c", "/a/b c", "a\\b", "a\\..\\b", "/a\\b", "/a/.b", "/a/..b", "/a/b..", "/a/b.", "/a/...", "/a/.../b", "./", "../", ".a/b", "..a/b", "a/.", "a/..", "/.", "/a/b/../..", "/a/b/../../..",
}

type pathRow struct {
	K                       string   `json:"k"`
	Name                    string   `json:"name"`
	Dir                     string   `json:"dir"`
	NormalizedAbsolutePath  string   `json:"getNormalizedAbsolutePath"`
	NormalizePath           string   `json:"normalizePath"`
	DirectoryPath           string   `json:"getDirectoryPath"`
	BaseFileName            string   `json:"getBaseFileName"`
	RootLength              int      `json:"getRootLength"`
	EncodedRootLength       int      `json:"getEncodedRootLength"`
	IsRootedDiskPath        bool     `json:"isRootedDiskPath"`
	PathIsAbsolute          bool     `json:"pathIsAbsolute"`
	CombinePaths            string   `json:"combinePaths"`
	ToPathSensitive         string   `json:"toPathCaseSensitive"`
	ToPathInsensitive       string   `json:"toPathCaseInsensitive"`
	AnyExtension            string   `json:"getAnyExtensionFromPath"`
	HasExtension            bool     `json:"hasExtension"`
	IsDts                   bool     `json:"fileExtensionIsDts"`
	ChangeExtensionTs       string   `json:"changeExtensionTs"`
	NormalizedComponents    []string `json:"getNormalizedPathComponents"`
	PathComponents          []string `json:"getPathComponents"`
	LowerCase               string   `json:"toFileNameLowerCase"`
	RemoveTrailingSeparator string   `json:"removeTrailingDirectorySeparator"`
	RemoveTrailingAll       string   `json:"removeTrailingDirectorySeparators"`
	EnsureTrailing          string   `json:"ensureTrailingDirectorySeparator"`
	HasTrailing             bool     `json:"hasTrailingDirectorySeparator"`
	ComparePathsCS          int      `json:"comparePathsCaseSensitive"`
	ComparePathsCI          int      `json:"comparePathsCaseInsensitive"`
	ContainsCS              bool     `json:"containsPathCaseSensitive"`
	ContainsCI              bool     `json:"containsPathCaseInsensitive"`
	RelativeCS              string   `json:"convertToRelativePathCaseSensitive"`
	RelativeCI              string   `json:"convertToRelativePathCaseInsensitive"`
}

func guard(f func() string) (out string) {
	defer func() {
		if e := recover(); e != nil {
			out = "panic: " + fmt.Sprint(e)
		}
	}()
	return f()
}

func pathRecord(name string, dir string) pathRow {
	cs := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true, CurrentDirectory: dir}
	ci := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: false, CurrentDirectory: dir}
	plainCS := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true, CurrentDirectory: ""}
	plainCI := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: false, CurrentDirectory: ""}
	r := pathRow{K: "path", Name: b64(name), Dir: b64(dir)}
	r.NormalizedAbsolutePath = b64(tspath.GetNormalizedAbsolutePath(name, dir))
	r.NormalizePath = b64(tspath.NormalizePath(name))
	r.DirectoryPath = b64(tspath.GetDirectoryPath(name))
	r.BaseFileName = b64(tspath.GetBaseFileName(name))
	r.RootLength = tspath.GetRootLength(name)
	r.EncodedRootLength = tspath.GetEncodedRootLength(name)
	r.IsRootedDiskPath = tspath.IsRootedDiskPath(name)
	r.PathIsAbsolute = tspath.PathIsAbsolute(name)
	r.CombinePaths = b64(tspath.CombinePaths(dir, name))
	r.ToPathSensitive = b64(string(tspath.ToPath(name, dir, true)))
	r.ToPathInsensitive = b64(string(tspath.ToPath(name, dir, false)))
	r.AnyExtension = b64(tspath.GetAnyExtensionFromPath(name, nil, false))
	r.HasExtension = tspath.HasExtension(name)
	r.IsDts = tspath.FileExtensionIs(name, tspath.ExtensionDts)
	r.ChangeExtensionTs = b64(tspath.ChangeExtension(name, ".ts"))
	r.NormalizedComponents = b64s(tspath.GetNormalizedPathComponents(name, dir))
	r.PathComponents = b64s(tspath.GetPathComponents(name, dir))
	r.LowerCase = b64(tspath.ToFileNameLowerCase(name))
	r.RemoveTrailingSeparator = b64(tspath.RemoveTrailingDirectorySeparator(name))
	r.RemoveTrailingAll = b64(tspath.RemoveTrailingDirectorySeparators(name))
	r.EnsureTrailing = b64(tspath.EnsureTrailingDirectorySeparator(name))
	r.HasTrailing = tspath.HasTrailingDirectorySeparator(name)
	r.ComparePathsCS = tspath.ComparePaths(name, dir, plainCS)
	r.ComparePathsCI = tspath.ComparePaths(name, dir, plainCI)
	r.ContainsCS = tspath.ContainsPath(dir, name, plainCS)
	r.ContainsCI = tspath.ContainsPath(dir, name, plainCI)
	r.RelativeCS = b64(guard(func() string { return tspath.ConvertToRelativePath(name, cs) }))
	r.RelativeCI = b64(guard(func() string { return tspath.ConvertToRelativePath(name, ci) }))
	return r
}

// Names and lists of extensions where a cut by a count of bytes and a cut by a count of code units differ.
var extNames = []string{
	"a.ts", "a.TS", "a.Ts", "a.tsx", "a.d.ts", "a.D.TS", "a", "a.", ".ts", "ts", "", "a.t\u017f", "a.T\u017f", "a.\u212a", "a.k", "a.K", "a.\u00e9", "a.\u00c9",
	"\u00e9.ts", "\u00e9.TS", "\u00e9.t\u017f", "a.ts/", "a.\u00e9/", "a.t\u017f/", "dir.ts/a", "a.\u0130", "a.i", "a.\u0131", "a.I", "a.\U00010400", "a.\U00010428",
	"a.\u1c89", "a.\u1c8a", "\u4e2d.\u6587", "x\u4e2d.k", "x.\u4e2d", "\u00e9", "a\u00e9ts", "a\u017f.ts", "a.\u017fts", "\u017f.t\u017f", "a.d.t\u017f", "\U0001F600.\U0001F600", "ab.\u00df", "a.SS",
}

var extLists = [][]string{
	{".ts", ".tsx", ".d.ts"},
	{"ts", "k", "\u00e9"},
	{".\u212a", ".t\u017f", ".\u00c9"},
	{".i", ".\u0131", ".\U00010428", ".\u1c8a", ".\u6587"},
	{".d.ts", ".ts", ".\U0001F600", ".ss"},
}

type extRow struct {
	K          string   `json:"k"`
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
	IgnoreCase bool     `json:"ignoreCase"`
	Any        string   `json:"getAnyExtensionFromPath"`
	Changed    string   `json:"changeAnyExtension"`
}

type decodeRow struct {
	K        string `json:"k"`
	Bytes    string `json:"bytes"`
	Contents string `json:"contents"`
	Valid    bool   `json:"valid"`
}

var decodeInputs = []string{
	"", "a", "\xef\xbb\xbfa", "\xef\xbb\xbf", "\xef\xbb\xbf\xef\xbb\xbfa", "\xef\xbb", "\xff\xfea\x00b\x00", "\xfe\xff\x00a\x00b", "\xff\xfe", "\xfe\xff",
	"\xff\xfea\x00b", "\xfe\xff\x00a\x00", "\xff\xfe\x3d\xd8\x00\xde", "\xfe\xff\xd8\x3d\xde\x00", "\xff\xfe\x3d\xd8a\x00", "\xff\xfe\x00\xdea\x00", "\xfe\xff\xd8\x3d",
	"\xff\xfe\xff\xfea\x00", "\xff\xfe\xef\xbb\xbf\x00", "\xffa", "\xfea", "a\xff\xfe", "\xc3\x28", "caf\xc3\xa9", "\xed\xa0\x80", "\x00\x00", "\xff\xfe\x00\x00", "\xff\xfe\x28\x20\x29\x20",
}

type atoiRow struct {
	K  string `json:"k"`
	S  string `json:"s"`
	N  int    `json:"n"`
	Ok bool   `json:"ok"`
}

var atoiInputs = []string{"0", "1", "-1", "+1", " 1", "1 ", "1_000", "0x10", "\uff19", "", "99999999999999999999", "-0", "007", "1e3", "2147483648", "-9223372036854775808", "9223372036854775808", "+", "-", "1.0", "٣"}

type sortRow struct {
	K      string   `json:"k"`
	Sorted []string `json:"sorted"`
}

type tableDigest struct {
	K       string `json:"k"`
	Lower   string `json:"lower"`
	FoldKey string `json:"foldKey"`
	Space   string `json:"space"`
	White   string `json:"white"`
}

// Digests of the tables over every code point, so that a test can hold them in place of the tables.
func tableDigests() tableDigest {
	lower, fold, space, white := sha256.New(), sha256.New(), sha256.New(), sha256.New()
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if l := unicode.ToLower(r); l != r {
			fmt.Fprintf(lower, "%x %x\n", r, l)
		}
		key := r
		for n := unicode.SimpleFold(r); n != r; n = unicode.SimpleFold(n) {
			key = min(key, n)
		}
		if key != r {
			fmt.Fprintf(fold, "%x %x\n", r, key)
		}
		if unicode.IsSpace(r) {
			fmt.Fprintf(space, "%x\n", r)
		}
		if stringutil.IsWhiteSpaceLike(r) {
			fmt.Fprintf(white, "%x %v %v\n", r, stringutil.IsWhiteSpaceSingleLine(r), stringutil.IsLineBreak(r))
		}
	}
	sum := func(h interface{ Sum([]byte) []byte }) string { return hex.EncodeToString(h.Sum(nil)) }
	return tableDigest{K: "tables", Lower: sum(lower), FoldKey: sum(fold), Space: sum(space), White: sum(white)}
}

func vectors(path string) {
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	w := bufio.NewWriterSize(f, 1<<20)
	defer w.Flush()
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	emit := func(v any) {
		if err := enc.Encode(v); err != nil {
			panic(err)
		}
	}
	emit(map[string]string{"k": "version", "unicode": unicode.Version})
	emit(tableDigests())
	for _, s := range fixedTexts {
		emit(textRecord(s))
	}
	for _, s := range textAtoms {
		emit(textRecord(s))
	}
	for k := 0; k < 1500; k++ {
		emit(textRecord(genText()))
	}
	seqSets(emit)
	for _, a := range pairStrings {
		for _, b := range pairStrings {
			emit(pairRow{
				K: "pair", A: b64(a), B: b64(b),
				Fold: strings.EqualFold(a, b),
				Cmp:  strings.Compare(a, b),
				CI:   stringutil.CompareStringsCaseInsensitive(a, b),
				CS:   stringutil.CompareStringsCaseSensitive(a, b),
			})
		}
	}
	for _, name := range pathStrings {
		for _, dir := range pathStrings {
			emit(pathRecord(name, dir))
		}
	}
	for _, name := range extNames {
		for _, list := range extLists {
			for _, ignoreCase := range []bool{false, true} {
				emit(extRow{
					K: "ext", Name: b64(name), Extensions: b64s(list), IgnoreCase: ignoreCase,
					Any:     b64(tspath.GetAnyExtensionFromPath(name, list, ignoreCase)),
					Changed: b64(tspath.ChangeAnyExtension(name, ".x", list, ignoreCase)),
				})
			}
		}
	}
	for _, s := range decodeInputs {
		c, _ := decodeBytes(s)
		if len(s) == 0 {
			c = ""
		}
		emit(decodeRow{K: "decode", Bytes: b64(s), Contents: b64(c), Valid: utf8.ValidString(c)})
	}
	for _, s := range atoiInputs {
		n, err := strconv.Atoi(s)
		emit(atoiRow{K: "atoi", S: b64(s), N: n, Ok: err == nil})
	}
	emit(sortRow{K: "sorted", Sorted: b64s(slices.Sorted(slices.Values(pairStrings)))})
	emit(map[string]string{"k": "pad", "a": fmt.Sprintf("%*s", 5, "ab"), "b": fmt.Sprintf("%*s", 1, "abc"), "c": fmt.Sprintf("%*d", 4, 42), "d": fmt.Sprintf("%*s", 0, "")})
}

func main() {
	switch os.Args[1] {
	case "tables":
		tables(os.Args[2])
	case "vectors":
		vectors(os.Args[2])
	default:
		panic("usage: gt tables <out.txt> | gt vectors <out.jsonl>")
	}
}
