// Parse oracle of typescript-go (the reference parser, internal/parser at 89d5d5b).
// Reads JSON lines on stdin: {"id": any, "name": "input.ts", "text": "..."}.
// Writes one JSON line per input:
//   {"id": ..., "n": <number of parse diagnostics>, "d": [[code, start, length, message], ...],
//    "js": [[...]], "jsdoc": [[...]], "panic": "..."}
// "d" is SourceFile.Diagnostics() (what tsc calls parseDiagnostics), in the order the parser recorded them.
// "js" is SourceFile.JSDiagnostics() (TypeScript-only syntax in a JavaScript file), "jsdoc" the JSDoc ones.
// Offsets are byte offsets of the UTF-8 text (tsc counts UTF-16 code units: equal for ASCII input only).
// The script kind comes from the extension of "name" (.ts .tsx .d.ts .mts .cts .js .jsx .mjs .cjs).
// usage: parsediag [-max N] < inputs.jsonl > out.jsonl      (-max caps the diagnostics kept per input, default 8)
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/tspath"
)

type input struct {
	ID   json.RawMessage `json:"id"`
	Name string          `json:"name"`
	Text string          `json:"text"`
}

type output struct {
	ID    json.RawMessage `json:"id"`
	N     int             `json:"n"`
	D     [][]any         `json:"d"`
	JS    [][]any         `json:"js,omitempty"`
	JSDoc [][]any         `json:"jsdoc,omitempty"`
	Panic string          `json:"panic,omitempty"`
}

func rows(ds []*ast.Diagnostic, max int) [][]any {
	out := make([][]any, 0, len(ds))
	for i, x := range ds {
		if i >= max {
			break
		}
		out = append(out, []any{int(x.Code()), x.Pos(), x.Len(), x.String()})
	}
	return out
}

func one(in input, max int) (res output) {
	res.ID = in.ID
	res.D = [][]any{}
	defer func() {
		if r := recover(); r != nil {
			res.Panic = fmt.Sprint(r)
			res.N = -1
		}
	}()
	name := in.Name
	if name == "" {
		name = "input.ts"
	}
	fileName := tspath.NormalizePath("/" + name)
	kind := core.EnsureScriptKindFromFileName(fileName)
	text := strings.TrimPrefix(in.Text, "\ufeff")
	sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: fileName,
		Path:     tspath.Path(fileName),
	}, text, kind)
	res.N = len(sf.Diagnostics())
	res.D = rows(sf.Diagnostics(), max)
	if js := sf.JSDiagnostics(); len(js) > 0 {
		res.JS = rows(js, max)
	}
	if jd := sf.JSDocDiagnostics(); len(jd) > 0 {
		res.JSDoc = rows(jd, max)
	}
	return res
}

func main() {
	max := 8
	args := os.Args[1:]
	for len(args) >= 2 && args[0] == "-max" {
		v, err := strconv.Atoi(args[1])
		if err != nil {
			fmt.Fprintln(os.Stderr, "bad -max")
			os.Exit(2)
		}
		max = v
		args = args[2:]
	}
	r := bufio.NewReaderSize(os.Stdin, 1<<20)
	w := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer w.Flush()
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for {
		line, err := r.ReadBytes('\n')
		if len(strings.TrimSpace(string(line))) > 0 {
			var in input
			if e := json.Unmarshal(line, &in); e != nil {
				fmt.Fprintln(os.Stderr, "bad input line:", e)
				os.Exit(2)
			}
			out := one(in, max)
			if e := enc.Encode(out); e != nil {
				fmt.Fprintln(os.Stderr, e)
				os.Exit(1)
			}
		}
		if err != nil {
			break
		}
	}
}
