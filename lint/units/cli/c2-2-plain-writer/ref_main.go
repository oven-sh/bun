package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"unicode"
)

type Locale struct{}

type Category int32

const (
	CategoryWarning Category = iota
	CategoryError
	CategorySuggestion
	CategoryMessage
)

func (category Category) Name() string {
	switch category {
	case CategoryWarning:
		return "warning"
	case CategoryError:
		return "error"
	case CategorySuggestion:
		return "suggestion"
	case CategoryMessage:
		return "message"
	}
	panic("Unhandled diagnostic category")
}

type FileLike interface {
	FileName() string
	Text() string
	ECMALineMap() []TextPos
}

type Diagnostic interface {
	File() FileLike
	Pos() int
	Code() int32
	Category() Category
	Source() string
	Localize(locale Locale) string
	MessageChain() []Diagnostic
}

type FormattingOptions struct {
	Locale Locale
	ComparePathsOptions
	NewLine string
}

type file struct {
	name, text string
	lineMap    []TextPos
}

func (f *file) FileName() string       { return f.name }
func (f *file) Text() string           { return f.text }
func (f *file) ECMALineMap() []TextPos { return f.lineMap }

type diag struct {
	file     *file
	pos      int
	code     int32
	category Category
	text     string
	chain    []Diagnostic
}

func (d *diag) File() FileLike {
	if d.file == nil {
		return nil
	}
	return d.file
}
func (d *diag) Pos() int                   { return d.pos }
func (d *diag) Code() int32                { return d.code }
func (d *diag) Category() Category         { return d.category }
func (d *diag) Source() string             { return "" }
func (d *diag) Localize(Locale) string     { return d.text }
func (d *diag) MessageChain() []Diagnostic { return d.chain }

func unhex(s string) string {
	if s == "-" {
		return ""
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func enhex(s string) string {
	if s == "" {
		return "-"
	}
	return hex.EncodeToString([]byte(s))
}

func atoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		panic(err)
	}
	return n
}

func main() {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer out.Flush()
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 1<<28)
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 0 {
			continue
		}
		switch f[0] {
		case "R":
			p := unhex(f[1])
			fmt.Fprintf(out, "R %d %d %t\n", GetRootLength(p), GetEncodedRootLength(p), IsRootedDiskPath(p))
		case "N":
			fmt.Fprintf(out, "N %s\n", enhex(GetNormalizedAbsolutePath(unhex(f[1]), unhex(f[2]))))
		case "C":
			opts := ComparePathsOptions{UseCaseSensitiveFileNames: f[3] == "1", CurrentDirectory: unhex(f[2])}
			fmt.Fprintf(out, "C %s\n", enhex(ConvertToRelativePath(unhex(f[1]), opts)))
		case "F":
			fmt.Fprintf(out, "F %t\n", EquateStringCaseInsensitive(unhex(f[1]), unhex(f[2])))
		case "U":
			fmt.Fprintf(out, "U %d\n", int(UTF16Len(unhex(f[1]))))
		case "L":
			text := unhex(f[1])
			fl := &file{name: "x", text: text, lineMap: []TextPos(ComputeECMALineStarts(text))}
			fmt.Fprint(out, "L")
			for _, s := range fl.lineMap {
				fmt.Fprintf(out, " %d", s)
			}
			fmt.Fprint(out, " |")
			for pos := 0; pos <= len(text); pos++ {
				line, ch := GetECMALineAndUTF16CharacterOfPosition(fl, pos)
				fmt.Fprintf(out, " %d:%d", line, int(ch))
			}
			fmt.Fprintln(out)
		case "W":
			i := 1
			next := func() string { s := f[i]; i++; return s }
			opts := &FormattingOptions{NewLine: unhex(next())}
			opts.CurrentDirectory = unhex(next())
			opts.UseCaseSensitiveFileNames = next() == "1"
			nfiles := atoi(next())
			files := make([]*file, nfiles)
			for k := range files {
				name := unhex(next())
				text := unhex(next())
				files[k] = &file{name: name, text: text, lineMap: []TextPos(ComputeECMALineStarts(text))}
			}
			ndiags := atoi(next())
			diags := make([]Diagnostic, ndiags)
			for k := range diags {
				d := &diag{}
				if fi := atoi(next()); fi >= 0 {
					d.file = files[fi]
				}
				d.pos = atoi(next())
				d.category = Category(atoi(next()))
				d.code = int32(atoi(next()))
				d.text = unhex(next())
				nchain := atoi(next())
				// The chain in preorder, each message with its level.
				var open []*diag
				open = append(open, d)
				for c := 0; c < nchain; c++ {
					level := atoi(next())
					m := &diag{text: unhex(next())}
					parent := open[level-1]
					parent.chain = append(parent.chain, m)
					open = append(open[:level], m)
				}
				diags[k] = d
			}
			var b strings.Builder
			WriteFormatDiagnostics(&b, diags, opts)
			fmt.Fprintf(out, "W %s\n", enhex(b.String()))
		case "K":
			for r := rune(0); r <= 0x10FFFF; r++ {
				if r >= 0xD800 && r <= 0xDFFF {
					continue
				}
				k := r
				for x := unicode.SimpleFold(r); x != r; x = unicode.SimpleFold(x) {
					if x < k {
						k = x
					}
				}
				fmt.Fprintf(out, "%X %X\n", r, k)
			}
		case "O":
			// Every pair inside an orbit of more than one code point, and some pairs across orbits.
			for r := rune(0); r <= 0x10FFFF; r++ {
				if r >= 0xD800 && r <= 0xDFFF || unicode.SimpleFold(r) == r {
					continue
				}
				for x := unicode.SimpleFold(r); x != r; x = unicode.SimpleFold(x) {
					fmt.Fprintf(out, "F %s %s\n", hex.EncodeToString([]byte(string(r))), hex.EncodeToString([]byte(string(x))))
				}
				for _, d := range []rune{1, -1, 32, -32, 2, -2, 8, -8, 48, -48, 0x20, 0x1C60} {
					x := r + d
					if x < 0 || x > 0x10FFFF || x >= 0xD800 && x <= 0xDFFF {
						continue
					}
					fmt.Fprintf(out, "F %s %s\n", hex.EncodeToString([]byte(string(r))), hex.EncodeToString([]byte(string(x))))
				}
			}
		default:
			panic("unknown vector " + f[0])
		}
	}
	if err := sc.Err(); err != nil {
		panic(err)
	}
}
