package main

import (
	"fmt"
	"iter"
	"slices"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

type TextPos int32
type UTF16Offset int

func IsLineBreak(ch rune) bool {
	return ch == '\n' || ch == '\r' || ch == 0x2028 || ch == 0x2029
}

// verbatim from internal/core/core.go (89d5d5b)
func ComputeECMALineStarts(text string) []TextPos {
	result := make([]TextPos, 0, strings.Count(text, "\n")+1)
	return slices.AppendSeq(result, ComputeECMALineStartsSeq(text))
}

func ComputeECMALineStartsSeq(text string) iter.Seq[TextPos] {
	return func(yield func(TextPos) bool) {
		textLen := TextPos(len(text))
		var pos TextPos
		var lineStart TextPos
		for pos < textLen {
			b := text[pos]
			if b < utf8.RuneSelf {
				pos++
				switch b {
				case '\r':
					if pos < textLen && text[pos] == '\n' {
						pos++
					}
					fallthrough
				case '\n':
					if !yield(lineStart) {
						return
					}
					lineStart = pos
				}
			} else {
				ch, size := utf8.DecodeRuneInString(text[pos:])
				pos += TextPos(size)
				if IsLineBreak(ch) {
					if !yield(lineStart) {
						return
					}
					lineStart = pos
				}
			}
		}
		yield(lineStart)
	}
}

func UTF16Len(s string) UTF16Offset {
	for i := range len(s) {
		if s[i] >= utf8.RuneSelf {
			n := UTF16Offset(i)
			for _, r := range s[i:] {
				n += UTF16Offset(utf16.RuneLen(r))
			}
			return n
		}
	}
	return UTF16Offset(len(s))
}

func ComputeLineOfPosition(lineStarts []TextPos, pos int) int {
	low := 0
	high := len(lineStarts) - 1
	for low <= high {
		middle := low + ((high - low) >> 1)
		value := int(lineStarts[middle])
		if value < pos {
			low = middle + 1
		} else if value > pos {
			high = middle - 1
		} else {
			return middle
		}
	}
	return low - 1
}

func lc(text string, pos int) string {
	m := ComputeECMALineStarts(text)
	line := ComputeLineOfPosition(m, pos)
	ch := UTF16Len(text[m[line]:pos])
	return fmt.Sprintf("(%d,%d)", line+1, int(ch)+1)
}

func main() {
	fmt.Println("starts", ComputeECMALineStarts("a\nb\r\nc\rd\u2028e\u2029f\n"))
	fmt.Println("starts empty", ComputeECMALineStarts(""))
	fmt.Println("starts bad", ComputeECMALineStarts("\xE2\x80"))
	fmt.Println("utf16", []UTF16Offset{
		UTF16Len("abc"), UTF16Len("\u00E9"), UTF16Len("\u4E2D"), UTF16Len("\U0001F600"),
		UTF16Len("\xFF"), UTF16Len("\xE2\x82"), UTF16Len("\xED\xA0\x80"), UTF16Len("\xC0\x80"),
		UTF16Len("\xF0\x9F\x98"), UTF16Len("\xF4\x90\x80\x80"),
	})
	fmt.Println("eof-after-lf", lc("ab\ncd\n", 6), "eof-no-lf", lc("ab\ncd", 5), "after-lone-cr", lc("ab\rcd", 3), lc("ab\rcd", 4),
		"after-crlf", lc("ab\r\ncd", 4), "after-ls", lc("ab\u2028cd", 5), "astral", lc("a\U0001F600b", 5), "empty", lc("", 0),
		"emoji-col", lc("const s = \"\U0001F600\"; let x: = 1;\n", 25), "f-eof", lc("function f() {\n", 15), "g", lc("a\rdebugger;\rb", 2))
	fmt.Println("cmp", strings.Compare("", "/a"), strings.Compare("/other/b.ts", "/proj/z.ts"), strings.Compare("no-compare", "use-isnan"))
	fmt.Println("slicescmp", slices.Compare([]string{"A"}, []string{"A | B"}), strings.Compare("Type 'A' is", "Type 'A | B' is"))
}
