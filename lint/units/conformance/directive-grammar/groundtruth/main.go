// Ground-truth dump: verbatim copies of the reference functions, standard library only.
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// ---- internal/vfs/internal/internal.go:170-194 (verbatim) ----

func decodeBytes(s string) (contents string, ok bool) {
	var bom [2]byte
	if len(s) >= 2 {
		bom = [2]byte{s[0], s[1]}
		switch bom {
		case [2]byte{0xFF, 0xFE}:
			return decodeUtf16(s[2:], binary.LittleEndian), true
		case [2]byte{0xFE, 0xFF}:
			return decodeUtf16(s[2:], binary.BigEndian), true
		}
	}
	if len(s) >= 3 && s[0] == 0xEF && s[1] == 0xBB && s[2] == 0xBF {
		s = s[3:]
	}

	return s, true
}

func decodeUtf16(s string, order binary.ByteOrder) string {
	ints := make([]uint16, len(s)/2)
	if err := binary.Read(strings.NewReader(s), order, &ints); err != nil {
		return ""
	}
	return string(utf16.Decode(ints))
}

// ---- internal/stringutil/util.go (verbatim) ----

func IsWhiteSpaceLike(ch rune) bool {
	return IsWhiteSpaceSingleLine(ch) || IsLineBreak(ch)
}

func IsWhiteSpaceSingleLine(ch rune) bool {
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

// ---- internal/scanner/scanner.go:2301-2495 (verbatim, ast.PositionIsSynthesized inlined as pos < 0) ----

type SkipTriviaOptions struct {
	StopAfterLineBreak bool
	StopAtComments     bool
	InJSDoc            bool
}

func SkipTrivia(text string, pos int) int {
	return SkipTriviaEx(text, pos, nil)
}

var branchHits = map[string]int{}

func SkipTriviaEx(text string, pos int, options *SkipTriviaOptions) int {
	if pos < 0 {
		return pos
	}
	if options == nil {
		options = &SkipTriviaOptions{}
	}

	textLen := len(text)
	canConsumeStar := false
	// Keep in sync with couldStartTrivia
	for {
		if pos >= textLen {
			return pos
		}
		ch, size := utf8.DecodeRuneInString(text[pos:])
		switch ch {
		case '\r':
			branchHits["cr"]++
			if pos+1 < textLen && text[pos+1] == '\n' {
				pos++
			}
			fallthrough
		case '\n':
			branchHits["lf"]++
			pos++
			if options.StopAfterLineBreak {
				return pos
			}
			canConsumeStar = options.InJSDoc
			continue
		case '\t', '\v', '\f', ' ':
			branchHits["ws"]++
			pos++
			continue
		case '/':
			if options.StopAtComments {
				break
			}
			if pos+1 < textLen {
				if text[pos+1] == '/' {
					branchHits["linecomment"]++
					pos += 2
					for pos < textLen {
						ch, size := utf8.DecodeRuneInString(text[pos:])
						if IsLineBreak(ch) {
							break
						}
						pos += size
					}
					canConsumeStar = false
					continue
				}
				if text[pos+1] == '*' {
					branchHits["blockcomment"]++
					pos += 2
					for pos < textLen {
						if text[pos] == '*' && (pos+1 < textLen) && text[pos+1] == '/' {
							pos += 2
							break
						}
						_, size := utf8.DecodeRuneInString(text[pos:])
						pos += size
					}
					canConsumeStar = false
					continue
				}
			}
		case '<', '|', '=', '>':
			branchHits["conflictcheck"]++
			if isConflictMarkerTrivia(text, pos) {
				branchHits["conflict"]++
				pos = scanConflictMarkerTrivia(text, pos)
				canConsumeStar = false
				continue
			}
		case '#':
			branchHits["hash"]++
			if pos == 0 && isShebangTrivia(text, pos) {
				branchHits["shebang"]++
				pos = scanShebangTrivia(text, pos)
				canConsumeStar = false
				continue
			}
		case '*':
			branchHits["star"]++
			if canConsumeStar {
				pos++
				canConsumeStar = false
				continue
			}
		default:
			if ch > rune(maxAsciiCharacter) && IsWhiteSpaceLike(ch) {
				branchHits["unicodews"]++
				pos += size
				continue
			}
		}
		branchHits["stop"]++
		return pos
	}
}

var (
	mergeConflictMarkerLength      = len("<<<<<<<")
	maxAsciiCharacter         byte = 127
)

func isConflictMarkerTrivia(text string, pos int) bool {
	if pos < 0 {
		panic("pos < 0")
	}
	if pos+1 >= len(text) || text[pos+1] != text[pos] {
		return false
	}
	atLineStart := pos == 0 || IsLineBreak(rune(text[pos-1]))
	if !atLineStart && pos >= 2 {
		prev, _ := utf8.DecodeLastRuneInString(text[:pos-2])
		atLineStart = IsLineBreak(prev)
	}
	if atLineStart {
		ch := text[pos]

		if (pos + mergeConflictMarkerLength) < len(text) {
			for i := range mergeConflictMarkerLength {
				if text[pos+i] != ch {
					return false
				}
			}

			return ch == '=' || text[pos+mergeConflictMarkerLength] == ' '
		}
	}

	return false
}

func scanConflictMarkerTrivia(text string, pos int) int {
	ch, size := utf8.DecodeRuneInString(text[pos:])
	length := len(text)

	if ch == '<' || ch == '>' {
		for pos < length && !IsLineBreak(ch) {
			pos += size
			ch, size = utf8.DecodeRuneInString(text[pos:])
		}
	} else {
		if ch != '|' && ch != '=' {
			panic("Assertion failed: ch must be either '|' or '='")
		}
		for pos < length {
			currentChar := text[pos]
			if (currentChar == '=' || currentChar == '>') && rune(currentChar) != ch && isConflictMarkerTrivia(text, pos) {
				break
			}

			pos++
		}
	}

	return pos
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

// ---- internal/tspath/path.go (verbatim subset) ----

const urlSchemeSeparator = "://"

func isAnyDirectorySeparator(char byte) bool {
	return char == '/' || char == '\\'
}

func HasTrailingDirectorySeparator(path string) bool {
	return len(path) > 0 && isAnyDirectorySeparator(path[len(path)-1])
}

func IsVolumeCharacter(char byte) bool {
	return char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z'
}

func getFileUrlVolumeSeparatorEnd(url string, start int) int {
	if len(url) <= start {
		return -1
	}
	ch0 := url[start]
	if ch0 == ':' {
		return start + 1
	}
	if ch0 == '%' && len(url) > start+2 && url[start+1] == '3' {
		ch2 := url[start+2]
		if ch2 == 'a' || ch2 == 'A' {
			return start + 3
		}
	}
	return -1
}

var rootKinds = map[string]int{}

func GetEncodedRootLength(path string) int {
	ln := len(path)
	if ln == 0 {
		rootKinds["empty"]++
		return 0
	}
	ch0 := path[0]

	// POSIX or UNC
	if ch0 == '/' || ch0 == '\\' {
		if ln == 1 || path[1] != ch0 {
			rootKinds["posix"]++
			return 1 // POSIX: "/" (or non-normalized "\")
		}

		offset := 2
		p1 := strings.IndexByte(path[offset:], ch0)
		if p1 < 0 {
			rootKinds["unc-noslash"]++
			return ln // UNC: "//server" or "\\server"
		}

		rootKinds["unc"]++
		return p1 + offset + 1 // UNC: "//server/" or "\\server\"
	}

	// DOS
	if IsVolumeCharacter(ch0) && ln > 1 && path[1] == ':' {
		if ln == 2 {
			rootKinds["dos2"]++
			return 2 // DOS: "c:" (but not "c:d")
		}
		ch2 := path[2]
		if ch2 == '/' || ch2 == '\\' {
			rootKinds["dos3"]++
			return 3 // DOS: "c:/" or "c:\"
		}
	}

	// Untitled paths (e.g., "^/untitled/ts-nul-authority/Untitled-1")
	if ch0 == '^' && ln > 1 && path[1] == '/' {
		rootKinds["untitled"]++
		return 2 // Untitled: "^/"
	}

	// URL
	schemeEnd := strings.Index(path, urlSchemeSeparator)
	if schemeEnd != -1 {
		rootKinds["url"]++
		authorityStart := schemeEnd + len(urlSchemeSeparator)
		authorityLength := strings.Index(path[authorityStart:], "/")
		if authorityLength != -1 { // URL: "file:///", "file://server/", "file://server/path"
			authorityEnd := authorityStart + authorityLength
			scheme := path[:schemeEnd]
			authority := path[authorityStart:authorityEnd]
			if scheme == "file" && (authority == "" || authority == "localhost") && (len(path) > authorityEnd+2) && IsVolumeCharacter(path[authorityEnd+1]) {
				volumeSeparatorEnd := getFileUrlVolumeSeparatorEnd(path, authorityEnd+2)
				if volumeSeparatorEnd != -1 {
					if volumeSeparatorEnd == len(path) {
						return ^volumeSeparatorEnd
					}
					if path[volumeSeparatorEnd] == '/' {
						return ^(volumeSeparatorEnd + 1)
					}
				}
			}
			return ^(authorityEnd + 1) // URL: "file://server/", "http://server/"
		}
		return ^ln // URL: "file://server", "http://server"
	}

	// relative
	rootKinds["relative"]++
	return 0
}

func GetRootLength(path string) int {
	rootLength := GetEncodedRootLength(path)
	if rootLength < 0 {
		return ^rootLength
	}
	return rootLength
}

func NormalizeSlashes(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}

func RemoveTrailingDirectorySeparator(path string) string {
	if HasTrailingDirectorySeparator(path) {
		return path[:len(path)-1]
	}
	return path
}

func GetBaseFileName(path string) string {
	path = NormalizeSlashes(path)

	// if the path provided is itself the root, then it has no file name.
	rootLength := GetRootLength(path)
	if rootLength == len(path) {
		return ""
	}

	// return the trailing portion of the path starting after the last (non-terminal) directory
	// separator but not including any trailing directory separator.
	path = RemoveTrailingDirectorySeparator(path)
	return path[max(GetRootLength(path), strings.LastIndex(path, string('/'))+1):]
}

// ---- internal/testutil/harnessutil/harnessutil.go:1228 (verbatim) ----

func GetConfigNameFromFileName(filename string) string {
	basenameLower := strings.ToLower(GetBaseFileName(filename))
	if basenameLower == "tsconfig.json" || basenameLower == "jsconfig.json" {
		return basenameLower
	}
	return ""
}

// ---- internal/testrunner/test_case_parser.go (verbatim; counter hooks added) ----

var lineDelimiter = regexp.MustCompile("\r?\n")

type rawCompilerSettings map[string]string

type testUnit struct {
	content string
	name    string
}

var optionRegex = regexp.MustCompile(`(?m)^\/{2}\s*@(\w+)\s*:\s*([^\r\n]*)`)

var linkRegex = regexp.MustCompile(`(?m)^\/{2}\s*@link\s*:\s*([^\r\n]*)\s*->\s*([^\r\n]*)`)

var fourslashDirectives = []string{"emitthisfile", "noopen"}

type ParseTestFilesOptions struct {
	AllowImplicitFirstFile bool
}

// hook counters (not in the reference)
var reachedSkipTrivia int
var emptyNameFilenameDirective int
var symlinkDirectiveNoFile int
var symlinkDirectiveWithFile int
var duplicateGlobalDifferent int
var linkLines int

func ParseTestFilesAndSymlinksWithOptions[T any](
	code string,
	fileName string,
	parseFile func(filename string, content string, fileOptions map[string]string) (T, error),
	options ParseTestFilesOptions,
) (units []T, symlinks map[string]string, currentDir string, globalOptions map[string]string, e error) {
	// List of all the subfiles we've parsed out
	var testUnits []T

	lines := lineDelimiter.Split(code, -1)

	// Stuff related to the subfile we're parsing
	var currentFileContent strings.Builder
	var currentFileName string
	seenContentLine := false
	hasSeenFile := false
	if options.AllowImplicitFirstFile {
		currentFileName = fileName
	}
	var currentDirectory string
	var parseError error
	currentFileOptions := make(map[string]string)
	symlinks = make(map[string]string)
	globalOptions = make(map[string]string)

	for _, line := range lines {
		ok := parseSymlinkFromTest(line, symlinks)
		if ok {
			linkLines++
			continue
		}
		if testMetaData := optionRegex.FindStringSubmatch(line); testMetaData != nil {
			// Comment line, check for global/file @options and record them
			metaDataName := strings.ToLower(testMetaData[1])
			metaDataValue := strings.TrimSpace(testMetaData[2])
			if metaDataName == "currentdirectory" {
				currentDirectory = metaDataValue
			}
			if metaDataName != "filename" {
				if metaDataName == "symlink" && currentFileName != "" {
					symlinkDirectiveWithFile++
					for link := range strings.SplitSeq(metaDataValue, ",") {
						link = strings.TrimSpace(link)
						if link != "" {
							symlinks[link] = currentFileName
						}
					}
				} else if slices.Contains(fourslashDirectives, metaDataName) {
					// File-specific option
					currentFileOptions[metaDataName] = metaDataValue
				} else {
					if metaDataName == "symlink" {
						symlinkDirectiveNoFile++
					}
					// Global option
					if existingValue, ok := globalOptions[metaDataName]; ok && existingValue != metaDataValue {
						duplicateGlobalDifferent++
						// !!! This would break existing submodule tests
						// panic("Duplicate global option: " + metaDataName)
					}
					globalOptions[metaDataName] = metaDataValue
				}
				continue
			}
			if metaDataValue == "" {
				emptyNameFilenameDirective++
			}

			// New metadata statement after having collected some code to go with the previous metadata
			if currentFileName != "" {
				// Store result file - always save for regular tests, but skip empty implicit first file for fourslash
				shouldSaveFile := !options.AllowImplicitFirstFile || currentFileContent.Len() != 0 || hasSeenFile
				if shouldSaveFile {
					hasSeenFile = true
					newTestFile, e := parseFile(currentFileName, currentFileContent.String(), currentFileOptions)
					if e != nil {
						parseError = e
						break
					}
					testUnits = append(testUnits, newTestFile)
				}

				// Reset local data
				currentFileContent.Reset()
				seenContentLine = false
				currentFileName = metaDataValue
				currentFileOptions = make(map[string]string)
			} else {
				// First metadata marker in the file
				if currentFileContent.Len() != 0 {
					reachedSkipTrivia++
				}
				hasContentBeforeFirstFilename := currentFileContent.Len() != 0 && SkipTrivia(currentFileContent.String(), 0) != currentFileContent.Len()
				if hasContentBeforeFirstFilename && !options.AllowImplicitFirstFile {
					panic("Non-comment test content appears before the first '// @Filename' directive")
				}

				// If we have content before the first @Filename and AllowImplicitFirstFile is true,
				// we need to save it as an implicit first file before starting the new file
				if hasContentBeforeFirstFilename && options.AllowImplicitFirstFile && currentFileName != "" {
					// Store the implicit first file
					hasSeenFile = true
					newTestFile, e := parseFile(currentFileName, currentFileContent.String(), currentFileOptions)
					if e != nil {
						parseError = e
						break
					}
					testUnits = append(testUnits, newTestFile)
				}

				// Reset for the new file
				currentFileContent.Reset()
				seenContentLine = false
				currentFileName = strings.TrimSpace(testMetaData[2])
				currentFileOptions = make(map[string]string)
			}
		} else {
			// Subfile content line
			if options.AllowImplicitFirstFile {
				if seenContentLine {
					currentFileContent.WriteRune('\n')
				}
				seenContentLine = true
			} else {
				if currentFileContent.Len() != 0 {
					currentFileContent.WriteRune('\n')
				}
			}
			currentFileContent.WriteString(line)
		}
	}

	// normalize the fileName for the single file case
	if len(testUnits) == 0 && len(currentFileName) == 0 {
		currentFileName = GetBaseFileName(fileName)
	}

	// if there are no parse errors so far, parse the rest of the file
	if parseError == nil {
		// EOF, push whatever remains
		newTestFile2, e := parseFile(currentFileName, currentFileContent.String(), currentFileOptions)

		parseError = e
		testUnits = append(testUnits, newTestFile2)
	}

	return testUnits, symlinks, currentDirectory, globalOptions, parseError
}

func extractCompilerSettings(content string) rawCompilerSettings {
	opts := make(map[string]string)

	for _, match := range optionRegex.FindAllStringSubmatch(content, -1) {
		opts[strings.ToLower(match[1])] = strings.TrimSuffix(strings.TrimSpace(match[2]), ";")
	}

	return opts
}

func parseSymlinkFromTest(line string, symlinks map[string]string) bool {
	linkMetaData := linkRegex.FindStringSubmatch(line)
	if len(linkMetaData) == 0 {
		return false
	}

	symlinks[strings.TrimSpace(linkMetaData[2])] = strings.TrimSpace(linkMetaData[1])
	return true
}

// ---- dump driver ----

type unitOut struct {
	Name   string            `json:"name"`
	Len    int               `json:"len"`
	Sha256 string            `json:"sha256"`
	Opts   map[string]string `json:"fileOptions"`
}

type counters struct {
	ReachedSkip            int `json:"reachedSkipTrivia"`
	EmptyNameFilename      int `json:"emptyNameFilenameDirective"`
	SymlinkNoFile          int `json:"symlinkDirectiveNoFile"`
	SymlinkWithFile        int `json:"symlinkDirectiveWithFile"`
	DuplicateGlobalDiffers int `json:"duplicateGlobalDifferent"`
	LinkLines              int `json:"linkLines"`
	SettingsSpanLine       int `json:"settingsMatchesSpanningLines"`
	SettingsMatches        int `json:"settingsMatches"`
}

type caseOut struct {
	Path             string            `json:"path"`
	DecodedLen       int               `json:"decodedLen"`
	DecodedSha256    string            `json:"decodedSha256"`
	Panic            string            `json:"panic"`
	Units            []unitOut         `json:"units"`
	ConfigUnit       *unitOut          `json:"configUnit"`
	Symlinks         map[string]string `json:"symlinks"`
	CurrentDirectory string            `json:"currentDirectory"`
	GlobalOptions    map[string]string `json:"globalOptions"`
	Settings         map[string]string `json:"settings"`
	Counters         counters          `json:"counters"`
}

func sha(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

type parsedUnit struct {
	u    *testUnit
	opts map[string]string
}

func runCase(root string, rel string, dumpDir string) (out caseOut) {
	out.Path = rel
	abs := filepath.Join(root, rel)
	b, err := os.ReadFile(abs)
	if err != nil {
		panic(err)
	}
	var content string
	if len(b) == 0 {
		content = ""
	} else {
		content, _ = decodeBytes(string(b))
	}
	out.DecodedLen = len(content)
	out.DecodedSha256 = sha(content)
	out.Settings = extractCompilerSettings(content)
	for _, m := range optionRegex.FindAllString(content, -1) {
		out.Counters.SettingsMatches++
		if strings.ContainsAny(m, "\n") {
			out.Counters.SettingsSpanLine++
		}
	}
	reachedSkipTrivia = 0
	emptyNameFilenameDirective = 0
	symlinkDirectiveNoFile = 0
	symlinkDirectiveWithFile = 0
	duplicateGlobalDifferent = 0
	linkLines = 0
	out.Units = []unitOut{}
	out.Symlinks = map[string]string{}
	out.GlobalOptions = map[string]string{}
	func() {
		defer func() {
			if r := recover(); r != nil {
				out.Panic = fmt.Sprint(r)
			}
		}()
		units, symlinks, currentDirectory, globalOptions, _ := ParseTestFilesAndSymlinksWithOptions(
			content,
			NormalizeSlashes(abs),
			func(filename string, content string, fileOptions map[string]string) (*parsedUnit, error) {
				return &parsedUnit{u: &testUnit{content: content, name: filename}, opts: fileOptions}, nil
			},
			ParseTestFilesOptions{},
		)
		out.Symlinks = symlinks
		out.CurrentDirectory = currentDirectory
		out.GlobalOptions = globalOptions
		// makeUnitsFromTest: first config unit is taken out of the list
		for i, data := range units {
			if GetConfigNameFromFileName(data.u.name) != "" {
				out.ConfigUnit = &unitOut{Name: data.u.name, Len: len(data.u.content), Sha256: sha(data.u.content), Opts: data.opts}
				units = slices.Delete(units, i, i+1)
				break
			}
		}
		for idx, data := range units {
			out.Units = append(out.Units, unitOut{Name: data.u.name, Len: len(data.u.content), Sha256: sha(data.u.content), Opts: data.opts})
			if dumpDir != "" {
				_ = os.MkdirAll(filepath.Join(dumpDir, rel), 0o755)
				_ = os.WriteFile(filepath.Join(dumpDir, rel, fmt.Sprintf("%d.bin", idx)), []byte(data.u.content), 0o644)
			}
		}
	}()
	out.Counters.ReachedSkip = reachedSkipTrivia
	out.Counters.EmptyNameFilename = emptyNameFilenameDirective
	out.Counters.SymlinkNoFile = symlinkDirectiveNoFile
	out.Counters.SymlinkWithFile = symlinkDirectiveWithFile
	out.Counters.DuplicateGlobalDiffers = duplicateGlobalDifferent
	out.Counters.LinkLines = linkLines
	return out
}

func mainDump() {
	root := os.Args[1]
	outPath := os.Args[2]
	dumpDir := ""
	if len(os.Args) > 3 {
		dumpDir = os.Args[3]
	}
	re := regexp.MustCompile(`\.tsx?$`)
	var rels []string
	for _, suite := range []string{"conformance", "compiler"} {
		_ = filepath.WalkDir(filepath.Join(root, suite), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && re.MatchString(NormalizeSlashes(path)) {
				r, _ := filepath.Rel(root, path)
				rels = append(rels, NormalizeSlashes(r))
			}
			return nil
		})
	}
	sort.Strings(rels)
	f, err := os.Create(outPath)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for _, rel := range rels {
		o := runCase(root, rel, dumpDir)
		if err := enc.Encode(o); err != nil {
			panic(err)
		}
	}
	fmt.Fprintln(os.Stderr, "cases:", len(rels))
	bh, _ := json.Marshal(branchHits)
	fmt.Fprintln(os.Stderr, "SkipTrivia branch hits:", string(bh))
	rk, _ := json.Marshal(rootKinds)
	fmt.Fprintln(os.Stderr, "GetEncodedRootLength kinds:", string(rk))
}
