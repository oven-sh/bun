package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"iter"
	"os"
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

// verbatim from internal/scanner/scanner.go (89d5d5b)
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

func main() {
	sc := bufio.NewScanner(os.Stdin)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		var text string
		if line != "-" {
			b, _ := hex.DecodeString(line)
			text = string(b)
		}
		m := ComputeECMALineStarts(text)
		fmt.Fprint(w, "[")
		for i, v := range m {
			if i > 0 {
				fmt.Fprint(w, ", ")
			}
			fmt.Fprint(w, int(v))
		}
		fmt.Fprint(w, "]")
		for pos := 0; pos <= len(text); pos++ {
			l := ComputeLineOfPosition(m, pos)
			c := UTF16Len(text[m[l]:pos])
			fmt.Fprintf(w, " %d:%d", l, int(c))
		}
		fmt.Fprintln(w)
	}
}
