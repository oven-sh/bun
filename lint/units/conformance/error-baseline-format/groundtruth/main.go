// The glue of the ground-truth writer: the types that the cut-out functions name, and the reading of cases.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Stands for *testing.T: a failed check is recorded and the function goes on, as assert.Check does.
type testingT struct{ failed []string }

func (t *testingT) Helper() {}

type assertT struct{}

var assert = assertT{}

func (assertT) Check(t *testingT, comparison bool, msgAndArgs ...any) bool {
	if !comparison {
		t.failed = append(t.failed, fmt.Sprint(msgAndArgs...))
	}
	return comparison
}

type cmpT struct{}

var cmp = cmpT{}

func (cmpT) Equal(a, b int) bool { return a == b }

// Stands for locale.Locale and locale.Default.
type Locale struct{}

var Default = Locale{}

// Stands for harnessutil.TestFile.
type TestFile struct {
	UnitName string
	Content  string
}

// Stands for *ast.SourceFile in the type assertion of iterateErrorBaseline: no file of a case is one.
type SourceFile struct{}

func (f *SourceFile) IsContentMapperSupplemental() bool { return false }
func (f *SourceFile) FileName() string                  { return "" }
func (f *SourceFile) Text() string                      { return "" }
func (f *SourceFile) ECMALineMap() []TextPos            { return nil }

// Stands for *diagnostics.Message: the text and the code are what the writer reads.
type Message struct {
	code int32
	text string
}

func (m *Message) Code() int32 { return m.code }
func (m *Message) Localize(locale Locale, args ...any) string {
	return Format(m.text, StringifyArgs(args))
}

var (
	File_appears_to_be_binary                           = &Message{code: 1490, text: "File appears to be binary."}
	Errors_Files                                        = &Message{code: 6041, text: "Errors  Files"}
	Found_1_error                                       = &Message{code: 6216, text: "Found 1 error."}
	Found_0_errors                                      = &Message{code: 6217, text: "Found {0} errors."}
	Found_1_error_in_0                                  = &Message{code: 6259, text: "Found 1 error in {0}"}
	Found_0_errors_in_the_same_file_starting_at_Colon_1 = &Message{code: 6260, text: "Found {0} errors in the same file, starting at: {1}"}
	Found_0_errors_in_1_files                           = &Message{code: 6261, text: "Found {0} errors in {1} files."}
)

type file struct {
	name    string
	text    string
	lineMap []TextPos
}

func (f *file) FileName() string { return f.name }
func (f *file) Text() string     { return f.text }
func (f *file) ECMALineMap() []TextPos {
	if f.lineMap == nil {
		f.lineMap = []TextPos(ComputeECMALineStarts(f.text))
	}
	return f.lineMap
}

type diag struct {
	file     *file
	pos, end int
	code     int32
	category Category
	source   string
	message  string
	chain    []Diagnostic
	related  []Diagnostic
	order    int
}

func (d *diag) File() FileLike {
	if d.file == nil {
		return nil
	}
	return d.file
}
func (d *diag) Pos() int                         { return d.pos }
func (d *diag) End() int                         { return d.end }
func (d *diag) Len() int                         { return d.end - d.pos }
func (d *diag) Code() int32                      { return d.code }
func (d *diag) Category() Category               { return d.category }
func (d *diag) Source() string                   { return d.source }
func (d *diag) Localize(locale Locale) string    { return d.message }
func (d *diag) MessageChain() []Diagnostic       { return d.chain }
func (d *diag) RelatedInformation() []Diagnostic { return d.related }

type jsonDiag struct {
	File     int        `json:"file"`
	Pos      int        `json:"pos"`
	End      int        `json:"end"`
	Code     int32      `json:"code"`
	Category int32      `json:"category"`
	Source   string     `json:"source"`
	Message  string     `json:"message"`
	Chain    []jsonDiag `json:"chain"`
	Related  []jsonDiag `json:"related"`
}

type jsonFile struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

type jsonCase struct {
	Name        string     `json:"name"`
	Pretty      bool       `json:"pretty"`
	Files       []jsonFile `json:"files"`
	Inputs      []jsonFile `json:"inputs"`
	Diagnostics []jsonDiag `json:"diagnostics"`
}

type jsonResult struct {
	Name   string   `json:"name"`
	Text   string   `json:"text"`
	Failed []string `json:"failed"`
	Panic  string   `json:"panic"`
}

func unb64(s string) string {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func convert(j jsonDiag, files []*file, order int) *diag {
	d := &diag{pos: j.Pos, end: j.End, code: j.Code, category: Category(j.Category), source: j.Source, message: unb64(j.Message), order: order}
	if j.File >= 0 {
		d.file = files[j.File]
	}
	for _, c := range j.Chain {
		d.chain = append(d.chain, convert(c, files, -1))
	}
	for _, r := range j.Related {
		d.related = append(d.related, convert(r, files, -1))
	}
	return d
}

func run(c jsonCase) (result jsonResult) {
	result.Name = c.Name
	defer func() {
		if r := recover(); r != nil {
			result.Panic = fmt.Sprint(r)
		}
	}()
	files := make([]*file, len(c.Files))
	for i, f := range c.Files {
		files[i] = &file{name: unb64(f.Name), text: unb64(f.Text)}
	}
	inputs := make([]*TestFile, len(c.Inputs))
	for i, f := range c.Inputs {
		inputs[i] = &TestFile{UnitName: unb64(f.Name), Content: unb64(f.Text)}
	}
	diags := make([]*diag, len(c.Diagnostics))
	for i, j := range c.Diagnostics {
		diags[i] = convert(j, files, i)
	}
	t := &testingT{}
	text := GetErrorBaseline(t, inputs, diags, func(a, b *diag) int { return a.order - b.order }, c.Pretty)
	result.Text = base64.StdEncoding.EncodeToString([]byte(text))
	result.Failed = t.failed
	return result
}

// Reads one case per line from the file named by the first argument and writes one result per line.
func main() {
	in, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer in.Close()
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 1<<20), 1<<30)
	enc := json.NewEncoder(out)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var c jsonCase
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			panic(err)
		}
		if err := enc.Encode(run(c)); err != nil {
			panic(err)
		}
	}
}
