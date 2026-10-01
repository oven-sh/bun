// Ground truth for the read side of the in-memory file system: the reference's own vfstest behind iovfs, driven by vectors.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"

	"github.com/microsoft/typescript-go/internal/vfs/vfstest"
)

type vector struct {
	Name     string            `json:"name"`
	Files    []string          `json:"files"`
	Symlinks map[string]string `json:"symlinks"`
	Ucsfn    bool              `json:"ucsfn"`
	Probes   []string          `json:"probes"`
}

type probeResult struct {
	Path        string   `json:"path"`
	Panic       string   `json:"panic,omitempty"`
	FileExists  bool     `json:"fileExists"`
	DirExists   bool     `json:"dirExists"`
	ReadOk      bool     `json:"readOk"`
	Contents    string   `json:"contents"`
	Realpath    string   `json:"realpath"`
	Files       []string `json:"files"`
	Directories []string `json:"directories"`
	Symlinks    []string `json:"symlinks"`
}

type result struct {
	Name   string        `json:"name"`
	Panic  string        `json:"panic,omitempty"`
	Probes []probeResult `json:"probes"`
}

func guard(f func()) (p string) {
	defer func() {
		if r := recover(); r != nil {
			p = fmt.Sprint(r)
		}
	}()
	f()
	return ""
}

func run(v vector) (r result) {
	r.Name = v.Name
	r.Probes = []probeResult{}
	r.Panic = guard(func() {
		m := map[string]any{}
		for _, f := range v.Files {
			m[f] = f
		}
		for link, target := range v.Symlinks {
			m[link] = vfstest.Symlink(target)
		}
		fs := vfstest.FromMap(m, v.Ucsfn)
		for _, p := range v.Probes {
			pr := probeResult{Path: p, Files: []string{}, Directories: []string{}, Symlinks: []string{}}
			pr.Panic = guard(func() {
				pr.FileExists = fs.FileExists(p)
				pr.DirExists = fs.DirectoryExists(p)
				pr.Contents, pr.ReadOk = fs.ReadFile(p)
				pr.Realpath = fs.Realpath(p)
				e := fs.GetAccessibleEntries(p)
				if e.Files != nil {
					pr.Files = e.Files
				}
				if e.Directories != nil {
					pr.Directories = e.Directories
				}
				for s := range e.Symlinks {
					pr.Symlinks = append(pr.Symlinks, s)
				}
				sort.Strings(pr.Symlinks)
			})
			r.Probes = append(r.Probes, pr)
		}
	})
	return r
}

func main() {
	// A cycle of links never ends in the reference: a small stack limit makes that a quick exit with a fatal error.
	debug.SetMaxStack(2 << 20)
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var in []vector
	if err := json.Unmarshal(data, &in); err != nil {
		panic(err)
	}
	start, err := strconv.Atoi(os.Args[3])
	if err != nil {
		panic(err)
	}
	out, err := os.OpenFile(os.Args[2], os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		panic(err)
	}
	defer out.Close()
	for _, v := range in[start:] {
		fmt.Fprintf(out, "%s\n", mustJSON(run(v)))
	}
	fmt.Fprintln(os.Stderr, runtime.Version())
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}
