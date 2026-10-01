// Parse oracle: runs the parser of typescript-go (89d5d5b) over inputs and prints its parse diagnostics.
//
// usage: parsediag [-force] [-jsx] < inputs.jsonl > out.jsonl
//
// One JSON object per input line:   {"id": <any JSON value>, "name": "input.ts", "src": "..."}
// `name` decides the script kind and the ambient context exactly as in the reference: .ts .mts .cts are
// TypeScript, .tsx is TSX, .js .mjs .cjs are JavaScript, .jsx is JSX, a name that ends in .d.ts / .d.mts /
// .d.cts is a declaration file.
//
// One JSON object per output line, flushed after every input, so that a driver can restart behind an
// input that kills the process (a stack overflow of Go cannot be recovered):
//   {"id":..., "name":..., "ok":true|false, "n":<count>, "diags":[[code,start,length,start16,length16,"message"],...],
//    "js":[...], "jsdoc":<count>, "panic":"..."}
// ok is true when the parser reported no diagnostic (Diagnostics(), the list tsc calls parseDiagnostics).
// start and length are byte offsets into the UTF-8 text (the unit of Bun's Loc). start16 and length16 are
// UTF-16 code units (the unit of tsc). "js" holds the diagnostics that only a JavaScript file gets
// (JSDiagnostics(), TS8xxx). "jsdoc" is the count of JSDocDiagnostics().
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"runtime/debug"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/tspath"
)

type input struct {
	ID   json.RawMessage `json:"id"`
	Name string          `json:"name"`
	Src  string          `json:"src"`
}

type output struct {
	ID    json.RawMessage `json:"id"`
	Name  string          `json:"name"`
	Ok    bool            `json:"ok"`
	N     int             `json:"n"`
	Diags [][]any         `json:"diags"`
	JS    [][]any         `json:"js,omitempty"`
	JSDoc int             `json:"jsdoc,omitempty"`
	Panic string          `json:"panic,omitempty"`
}

func units16(s string) int {
	n := 0
	for _, r := range s {
		if r == utf8.RuneError {
			n++
			continue
		}
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func rows(text string, list []*ast.Diagnostic) [][]any {
	out := make([][]any, 0, len(list))
	for _, d := range list {
		pos := clamp(d.Pos(), 0, len(text))
		end := clamp(d.End(), pos, len(text))
		s16 := units16(text[:pos])
		l16 := units16(text[pos:end])
		out = append(out, []any{d.Code(), d.Pos(), d.Len(), s16, l16, d.String()})
	}
	return out
}

func run(in input, opts ast.ExternalModuleIndicatorOptions) (out output) {
	out.ID = in.ID
	out.Name = in.Name
	out.Diags = [][]any{}
	defer func() {
		if r := recover(); r != nil {
			out.Ok = false
			out.Panic = fmt.Sprint(r)
		}
	}()
	fileName := tspath.NormalizePath("/" + in.Name)
	kind := core.EnsureScriptKindFromFileName(fileName)
	sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName:                       fileName,
		Path:                           tspath.Path(fileName),
		ExternalModuleIndicatorOptions: opts,
	}, in.Src, kind)
	out.Diags = rows(in.Src, sf.Diagnostics())
	out.N = len(out.Diags)
	out.Ok = out.N == 0
	out.JS = rows(in.Src, sf.JSDiagnostics())
	out.JSDoc = len(sf.JSDocDiagnostics())
	return out
}

func main() {
	var opts ast.ExternalModuleIndicatorOptions
	for _, a := range os.Args[1:] {
		switch a {
		case "-force":
			opts.Force = true
		case "-jsx":
			opts.JSX = true
		}
	}
	debug.SetMaxStack(512 << 20)
	r := bufio.NewReaderSize(os.Stdin, 1<<20)
	w := bufio.NewWriterSize(os.Stdout, 1<<16)
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 1 {
			var in input
			if jerr := json.Unmarshal(line, &in); jerr != nil {
				fmt.Fprintln(os.Stderr, "bad input line:", jerr)
			} else {
				b, _ := json.Marshal(run(in, opts))
				w.Write(b)
				w.WriteByte('\n')
				w.Flush()
			}
		}
		if err != nil {
			break
		}
	}
}
