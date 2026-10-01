// Usage (Go 1.24 or later, standard library only, no network):
//
//	GOTOOLCHAIN=local go build -o gts .
//	./gts canon <TypeScript>/tests/cases cases.tsv      one line per case: path TAB sha256 of the canonical record
//	./gts dump <TypeScript>/tests/cases dump.jsonl      the full record of every case as JSON lines
//	./gts inputs.json > expected.json                   the reference's results for hand-written inputs
//
// The functions in main.go are verbatim copies of typescript-go at 89d5d5b (Apache-2.0); counters are the only additions.
package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
)

type synthIn struct {
	Name     string `json:"name"`
	FileName string `json:"fileName"`
	// base64 of the raw file bytes
	Bytes string `json:"bytes"`
	// when true the bytes go through decodeBytes first
	Implicit bool `json:"allowImplicitFirstFile"`
	// the callback fails for a unit with this name
	FailOn string `json:"failOn"`
}

type synthUnit struct {
	Name    string            `json:"name"`
	Content string            `json:"content"`
	Opts    map[string]string `json:"fileOptions"`
}

type synthOut struct {
	Name             string            `json:"name"`
	Decoded          string            `json:"decoded"`
	Lines            []string          `json:"lines"`
	Settings         map[string]string `json:"settings"`
	Panic            string            `json:"panic"`
	Units            []synthUnit       `json:"units"`
	ConfigUnit       *synthUnit        `json:"configUnit"`
	Symlinks         map[string]string `json:"symlinks"`
	CurrentDirectory string            `json:"currentDirectory"`
	GlobalOptions    map[string]string `json:"globalOptions"`
	SkipTrivia       int               `json:"skipTrivia"`
	Error            string            `json:"error"`
	DecodedByteLen   int               `json:"decodedByteLen"`
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "dump" {
		os.Args = os.Args[1:]
		mainDump()
		return
	}
	if len(os.Args) > 3 && os.Args[1] == "canon" {
		show := ""
		if len(os.Args) > 4 {
			show = os.Args[4]
		}
		mainCanon(os.Args[2], os.Args[3], show)
		return
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var ins []synthIn
	if err := json.Unmarshal(raw, &ins); err != nil {
		panic(err)
	}
	var outs []synthOut
	for _, in := range ins {
		b, err := base64.StdEncoding.DecodeString(in.Bytes)
		if err != nil {
			panic(err)
		}
		var o synthOut
		o.Name = in.Name
		content := ""
		if len(b) != 0 {
			content, _ = decodeBytes(string(b))
		}
		o.Decoded = content
		o.DecodedByteLen = len(content)
		o.Lines = lineDelimiter.Split(content, -1)
		o.Settings = extractCompilerSettings(content)
		o.SkipTrivia = SkipTrivia(content, 0)
		o.Units = []synthUnit{}
		o.Symlinks = map[string]string{}
		o.GlobalOptions = map[string]string{}
		func() {
			defer func() {
				if r := recover(); r != nil {
					o.Panic = fmt.Sprint(r)
				}
			}()
			units, symlinks, cd, g, e := ParseTestFilesAndSymlinksWithOptions(content, in.FileName,
				func(filename string, content string, fileOptions map[string]string) (*synthUnit, error) {
					if in.FailOn != "" && filename == in.FailOn {
						return &synthUnit{Name: "FAILED:" + filename, Content: content, Opts: fileOptions}, errors.New("cannot parse " + filename)
					}
					return &synthUnit{Name: filename, Content: content, Opts: fileOptions}, nil
				}, ParseTestFilesOptions{AllowImplicitFirstFile: in.Implicit})
			if e != nil {
				o.Error = e.Error()
			}
			o.Symlinks = symlinks
			o.CurrentDirectory = cd
			o.GlobalOptions = g
			if !in.Implicit {
				for i, data := range units {
					if GetConfigNameFromFileName(data.Name) != "" {
						o.ConfigUnit = data
						units = slices.Delete(units, i, i+1)
						break
					}
				}
			}
			for _, u := range units {
				o.Units = append(o.Units, *u)
			}
		}()
		outs = append(outs, o)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(outs); err != nil {
		panic(err)
	}
}
