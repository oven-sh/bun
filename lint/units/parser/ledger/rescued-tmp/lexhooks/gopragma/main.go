package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type TextRange struct{ pos, end int }

func NewTextRange(pos, end int) TextRange { return TextRange{pos, end} }
func (t TextRange) Pos() int             { return t.pos }
func (t TextRange) End() int             { return t.end }

type Kind int

const (
	KindSingleLineCommentTrivia Kind = 1
	KindMultiLineCommentTrivia  Kind = 2
)

type CommentRange struct {
	TextRange
	Kind               Kind
	HasTrailingNewLine bool
}
type PragmaArgument struct {
	TextRange
	Name  string
	Value string
}
type Pragma struct {
	CommentRange
	Name string
	Args map[string]PragmaArgument
}
type NodeFactory struct{}

func (f *NodeFactory) NewCommentRange(kind Kind, pos int, end int, hasTrailingNewLine bool) CommentRange {
	return CommentRange{TextRange: NewTextRange(pos, end), Kind: kind, HasTrailingNewLine: hasTrailingNewLine}
}


func IsWhiteSpaceLike(ch rune) bool {
	return IsWhiteSpaceSingleLine(ch) || IsLineBreak(ch)
}

func IsWhiteSpaceSingleLine(ch rune) bool {
	// Note: nextLine is in the Zs space, and should be considered to be a whitespace.
	// It is explicitly not a line-break as it isn't in the exact set specified by EcmaScript.
	switch ch {
	case
		' ',    // space
		'\t',   // tab
		'\v',   // verticalTab
		'\f',   // formFeed
		0x0085, // nextLine
		0x00A0, // nonBreakingSpace
		0x1680, // ogham
		0x2000, // enQuad
		0x2001, // emQuad
		0x2002, // enSpace
		0x2003, // emSpace
		0x2004, // threePerEmSpace
		0x2005, // fourPerEmSpace
		0x2006, // sixPerEmSpace
		0x2007, // figureSpace
		0x2008, // punctuationEmSpace
		0x2009, // thinSpace
		0x200A, // hairSpace
		0x200B, // zeroWidthSpace
		0x202F, // narrowNoBreakSpace
		0x205F, // mathematicalSpace
		0x3000, // ideographicSpace
		0xFEFF: // byteOrderMark
		return true
	}
	return false
}

func IsLineBreak(ch rune) bool {
	// ES5 7.3:
	// The ECMAScript line terminator characters are listed in Table 3.
	//     Table 3: Line Terminator Characters
	//     Code Unit Value     Name                    Formal Name
	//     \u000A              Line Feed               <LF>
	//     \u000D              Carriage Return         <CR>
	//     \u2028              Line separator          <LS>
	//     \u2029              Paragraph separator     <PS>
	// Only the characters in Table 3 are treated as line terminators. Other new line or line
	// breaking characters are treated as white space but not as line terminators.
	switch ch {
	case
		'\n',   // lineFeed
		'\r',   // carriageReturn
		0x2028, // lineSeparator
		0x2029: // paragraphSeparator
		return true
	}
	return false
}

func isShebangTrivia(text string, pos int) bool {
	if len(text) < 2 {
		return false
	}
	if pos != 0 {
		panic("Shebangs check must only be done at the start of the file")
	}
	return text[0] == '#' && text[1] == '!'
}

func scanShebangTrivia(text string, pos int) int {
	pos += 2
	for pos < len(text) {
		ch, size := utf8.DecodeRuneInString(text[pos:])
		if IsLineBreak(ch) {
			break
		}
		pos += size
	}
	return pos
}

func iterateCommentRanges(f *NodeFactory, text string, pos int, trailing bool) func(yield func(CommentRange) bool) {
	return func(yield func(CommentRange) bool) {
		var pendingPos int
		var pendingEnd int
		var pendingKind Kind
		var pendingHasTrailingNewLine bool
		hasPendingCommentRange := false
		collecting := trailing
		if pos == 0 {
			collecting = true
			if isShebangTrivia(text, pos) {
				pos = scanShebangTrivia(text, pos)
			}
		}
	scan:
		for pos >= 0 && pos < len(text) {
			ch, size := utf8.DecodeRuneInString(text[pos:])
			switch ch {
			case '\r':
				if pos+1 < len(text) && text[pos+1] == '\n' {
					pos++
				}
				fallthrough
			case '\n':
				pos++
				if trailing {
					break scan
				}

				collecting = true
				if hasPendingCommentRange {
					pendingHasTrailingNewLine = true
				}

				continue
			case '\t', '\v', '\f', ' ':
				pos++
				continue
			case '/':
				var nextChar byte
				if pos+1 < len(text) {
					nextChar = text[pos+1]
				}
				hasTrailingNewLine := false
				if nextChar == '/' || nextChar == '*' {
					var kind Kind
					if nextChar == '/' {
						kind = KindSingleLineCommentTrivia
					} else {
						kind = KindMultiLineCommentTrivia
					}

					startPos := pos
					pos += 2
					if nextChar == '/' {
						for pos < len(text) {
							c, s := utf8.DecodeRuneInString(text[pos:])
							if IsLineBreak(c) {
								hasTrailingNewLine = true
								break
							}
							pos += s
						}
					} else {
						if i := strings.Index(text[pos:], "*/"); i >= 0 {
							pos += i + 2
						} else {
							pos = len(text)
						}
					}

					if collecting {
						if hasPendingCommentRange {
							if !yield(f.NewCommentRange(pendingKind, pendingPos, pendingEnd, pendingHasTrailingNewLine)) {
								return
							}
						}

						pendingPos = startPos
						pendingEnd = pos
						pendingKind = kind
						pendingHasTrailingNewLine = hasTrailingNewLine
						hasPendingCommentRange = true
					}

					continue
				}
				break scan
			default:
				if ch > unicode.MaxASCII && IsWhiteSpaceLike(ch) {
					if hasPendingCommentRange && IsLineBreak(ch) {
						pendingHasTrailingNewLine = true
					}
					pos += size
					continue
				}
				break scan
			}
		}

		if hasPendingCommentRange {
			yield(f.NewCommentRange(pendingKind, pendingPos, pendingEnd, pendingHasTrailingNewLine))
		}
	}
}

func getCommentPragmas(f *NodeFactory, sourceText string) (pragmas []Pragma) {
	for commentRange := range iterateCommentRanges(f, sourceText, 0, false) {
		comment := sourceText[commentRange.Pos():commentRange.End()]
		pragmas = append(pragmas, extractPragmas(commentRange, comment)...)
	}
	return pragmas
}

func extractPragmas(commentRange CommentRange, text string) []Pragma {
	if commentRange.Kind == KindSingleLineCommentTrivia {
		pos := 2
		tripleSlash := match(text, pos, "/")
		if tripleSlash {
			pos++
		}
		pos = skipBlanks(text, pos)
		if tripleSlash && match(text, pos, "<") {
			tagName := extractName(text, pos+1)
			if tagName != "reference" {
				return nil
			}
			pos += 10
			args := make(map[string]PragmaArgument)
			for {
				pos = skipBlanks(text, pos)
				if match(text, pos, "/>") {
					break
				}
				argName := extractName(text, pos)
				if argName == "" {
					break
				}
				pos = skipBlanks(text, pos+len(argName))
				if !match(text, pos, "=") {
					break
				}
				pos = skipBlanks(text, pos+1)
				value, ok := extractQuotedString(text, pos)
				if !ok {
					break
				}
				args[argName] = PragmaArgument{
					Name:      argName,
					Value:     value,
					TextRange: NewTextRange(commentRange.Pos()+pos+1, commentRange.Pos()+pos+1+len(value)),
				}
				pos += len(value) + 2
			}
			return []Pragma{{
				CommentRange: commentRange,
				Name:         "reference",
				Args:         args,
			}}
		}
		if match(text, pos, "@") {
			pos++
			pragmaName := extractName(text, pos)
			if !(pragmaName == "ts-check" || pragmaName == "ts-nocheck") {
				return nil
			}
			return []Pragma{{
				CommentRange: commentRange,
				Name:         pragmaName,
			}}
		}
	}
	if commentRange.Kind == KindMultiLineCommentTrivia {
		text = strings.TrimSuffix(text, "*/")
		pos := 2
		var pragmas []Pragma
		for {
			if pos = skipTo(text, pos, "@"); pos < 0 {
				break
			}
			// Mirrors the /@(\S+)(\s+(?:\S.*)?)?$/gm pragma regex used by TypeScript: the '@'
			// must be immediately followed by a non-whitespace pragma name, and the remainder
			// of the line is consumed as that pragma's arguments. As a consequence, only the
			// first '@'-token on a line is considered, so an unrelated '@token' earlier on the
			// line (e.g. an email address) prevents a later '@jsx' on the same line from being
			// treated as a pragma.
			namePos := pos + 1
			nameEnd := skipNonBlanks(text, namePos)
			if nameEnd == namePos {
				pos++
				continue
			}
			lineEnd := lineEndPos(text, pos)
			pragmaName := strings.ToLower(text[namePos:nameEnd])
			if pragmaName == "jsx" || pragmaName == "jsxfrag" || pragmaName == "jsximportsource" || pragmaName == "jsxruntime" {
				start := skipBlanks(text, nameEnd)
				argEnd := skipNonBlanks(text, start)
				if argEnd != start {
					args := make(map[string]PragmaArgument, 1)
					args["factory"] = PragmaArgument{
						Name:      "factory",
						Value:     text[start:argEnd],
						TextRange: NewTextRange(commentRange.Pos()+start, commentRange.Pos()+argEnd),
					}
					pragmas = append(pragmas, Pragma{
						CommentRange: commentRange,
						Name:         pragmaName,
						Args:         args,
					})
				}
			}
			pos = lineEnd
		}
		return pragmas
	}
	return nil
}

func match(text string, pos int, s string) bool {
	return strings.HasPrefix(text[pos:], s)
}

func skipBlanks(text string, pos int) int {
	for pos < len(text) && (text[pos] == ' ' || text[pos] == '\t') {
		pos++
	}
	return pos
}

func skipNonBlanks(text string, pos int) int {
	for pos < len(text) && (text[pos] != ' ' && text[pos] != '\t' && text[pos] != '\r' && text[pos] != '\n') {
		pos++
	}
	return pos
}

func skipTo(text string, pos int, s string) int {
	if pos >= len(text) {
		return -1
	}
	i := strings.Index(text[pos:], s)
	if i < 0 {
		return -1
	}
	return pos + i
}

func lineEndPos(text string, pos int) int {
	for pos < len(text) {
		ch, size := utf8.DecodeRuneInString(text[pos:])
		if IsLineBreak(ch) {
			return pos
		}
		pos += size
	}
	return len(text)
}

func extractName(text string, pos int) string {
	start := pos
	for pos < len(text) && (text[pos] >= 'A' && text[pos] <= 'Z' || text[pos] >= 'a' && text[pos] <= 'z' || text[pos] == '-') {
		pos++
	}
	return strings.ToLower(text[start:pos])
}

func extractQuotedString(text string, pos int) (string, bool) {
	if pos == len(text) {
		return "", false
	}
	quote := text[pos]
	if quote != '\'' && quote != '"' {
		return "", false
	}
	pos++
	start := pos
	for pos < len(text) && text[pos] != quote {
		pos++
	}
	if pos == len(text) {
		return "", false
	}
	return text[start:pos], true
}

type FileReference struct {
	TextRange
	FileName       string
	ResolutionMode string
	Preserve       bool
}

func main() {
	var inputs [][]string
	data, _ := os.ReadFile(os.Args[1])
	if err := json.Unmarshal(data, &inputs); err != nil {
		panic(err)
	}
	for _, in := range inputs {
		text := in[1]
		pragmas := getCommentPragmas(&NodeFactory{}, text)
		var refs, types, libs []string
		var diags []string
		checkJs := "none"
		checkPos := -1
		for _, pragma := range pragmas {
			switch pragma.Name {
			case "reference":
				ty, typesOk := pragma.Args["types"]
				lib, libOk := pragma.Args["lib"]
				path, pathOk := pragma.Args["path"]
				resolutionMode, resolutionModeOk := pragma.Args["resolution-mode"]
				preserve, preserveOk := pragma.Args["preserve"]
				noDefaultLib, noDefaultLibOk := pragma.Args["no-default-lib"]
				pres := ""
				if preserveOk && preserve.Value == "true" {
					pres = " preserve"
				}
				switch {
				case noDefaultLibOk && noDefaultLib.Value == "true":
				case typesOk:
					mode := ""
					if resolutionModeOk {
						if resolutionMode.Value == "import" {
							mode = " mode=import"
						} else if resolutionMode.Value == "require" {
							mode = " mode=require"
						} else {
							diags = append(diags, fmt.Sprintf("TS1453@%d+%d", resolutionMode.Pos(), resolutionMode.End()-resolutionMode.Pos()))
						}
					}
					types = append(types, fmt.Sprintf("%s@%d-%d%s%s", ty.Value, ty.Pos(), ty.End(), mode, pres))
				case libOk:
					libs = append(libs, fmt.Sprintf("%s@%d-%d%s", lib.Value, lib.Pos(), lib.End(), pres))
				case pathOk:
					refs = append(refs, fmt.Sprintf("%s@%d-%d%s", path.Value, path.Pos(), path.End(), pres))
				default:
					diags = append(diags, fmt.Sprintf("TS1084@%d+%d", pragma.Pos(), pragma.End()-pragma.Pos()))
				}
			case "ts-check", "ts-nocheck":
				if checkPos < 0 || pragma.Pos() > checkPos {
					checkPos = pragma.Pos()
					checkJs = fmt.Sprintf("enabled=%v@%d-%d", pragma.Name == "ts-check", pragma.Pos(), pragma.End())
				}
			}
		}
		var ps []string
		for _, pragma := range pragmas {
			var keys []string
			for k := range pragma.Args {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			var as []string
			for _, k := range keys {
				a := pragma.Args[k]
				as = append(as, fmt.Sprintf("%s=%q@%d-%d", k, a.Value, a.Pos(), a.End()))
			}
			ps = append(ps, fmt.Sprintf("%s[%d-%d kind=%d nl=%v]{%s}", pragma.Name, pragma.Pos(), pragma.End(), pragma.Kind, pragma.HasTrailingNewLine, strings.Join(as, ",")))
		}
		j, _ := json.Marshal(text)
		fmt.Printf("%s\n  ref=%v types=%v lib=%v checkJs=%s diags=%v\n  pragmas=%v\n", j, refs, types, libs, checkJs, diags, ps)
	}
	_ = unicode.MaxASCII
	_ = utf8.RuneError
}
