// Research tool: type-checks the probe sources from source, through the build overlay, in about a minute, so that a
// mistake in them shows before the long build does. Third-party imports are empty stand-ins, so only the errors that
// lie in overlay files are printed; the count of the others is given per package.
// usage: tcheck <overlay.json> <reference root> <package dir relative to the root>...
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build/constraint"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const modPrefix = "github.com/microsoft/typescript-go/"

type imp struct {
	root    string
	overlay map[string]string
	fset    *token.FileSet
	std     types.Importer
	cache   map[string]*types.Package
	shown   int
	fakes   []string
	other   map[string]int
}

func (im *imp) Import(path string) (*types.Package, error) { return im.ImportFrom(path, "", 0) }

func matchFile(name string, src []byte) bool {
	if strings.HasSuffix(name, "_test.go") {
		return false
	}
	base := strings.TrimSuffix(name, ".go")
	for _, o := range []string{"windows", "darwin", "js", "wasm", "freebsd", "plan9", "wasip1"} {
		if strings.HasSuffix(base, "_"+o) {
			return false
		}
	}
	for _, line := range strings.Split(string(src), "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "package ") {
			break
		}
		if constraint.IsGoBuild(l) {
			if x, err := constraint.Parse(l); err == nil {
				if !x.Eval(func(tag string) bool { return tag == "linux" || tag == "amd64" || tag == "unix" || strings.HasPrefix(tag, "go1.") }) {
					return false
				}
			}
		}
	}
	return true
}

func (im *imp) load(path string) *types.Package {
	if p, ok := im.cache[path]; ok {
		return p
	}
	im.cache[path] = nil
	dir := filepath.Join(im.root, strings.TrimPrefix(path, modPrefix))
	names := map[string]string{}
	if ents, err := os.ReadDir(dir); err == nil {
		for _, e := range ents {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".go") {
				names[filepath.Join(dir, e.Name())] = filepath.Join(dir, e.Name())
			}
		}
	}
	for k, v := range im.overlay {
		if filepath.Dir(k) == dir && strings.HasSuffix(k, ".go") {
			names[k] = v
		}
	}
	keys := make([]string, 0, len(names))
	for k := range names {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var files []*ast.File
	for _, k := range keys {
		src, err := os.ReadFile(names[k])
		if err != nil || !matchFile(filepath.Base(k), src) {
			continue
		}
		f, err := parser.ParseFile(im.fset, k, src, parser.SkipObjectResolution)
		if err != nil {
			fmt.Println("parse error:", err)
			im.shown++
			if f == nil {
				continue
			}
		}
		files = append(files, f)
	}
	if len(files) == 0 {
		fmt.Println("no files for", path)
		im.shown++
		return nil
	}
	conf := types.Config{
		Importer: im,
		Error: func(err error) {
			te, ok := err.(types.Error)
			if ok {
				if _, mine := im.overlay[te.Fset.Position(te.Pos).Filename]; mine && !im.standIn(te.Msg) {
					fmt.Println("error:", err)
					im.shown++
					return
				}
			}
			im.other[path]++
		},
		FakeImportC: true,
		GoVersion:   "go1.26",
	}
	pkg, _ := conf.Check(path, im.fset, files, nil)
	im.cache[path] = pkg
	return pkg
}

// standIn reports an error that only says that a member of an empty stand-in package is missing.
func (im *imp) standIn(msg string) bool {
	for _, n := range im.fakes {
		if strings.HasPrefix(msg, "undefined: "+n+".") {
			return true
		}
	}
	return false
}

func (im *imp) ImportFrom(path, dir string, mode types.ImportMode) (*types.Package, error) {
	if strings.HasPrefix(path, modPrefix) {
		p := im.load(path)
		if p == nil {
			return nil, fmt.Errorf("cannot load %s", path)
		}
		return p, nil
	}
	if !strings.Contains(strings.Split(path, "/")[0], ".") {
		return im.std.Import(path)
	}
	if p, ok := im.cache[path]; ok && p != nil {
		return p, nil
	}
	pkg := types.NewPackage(path, path[strings.LastIndex(path, "/")+1:])
	im.fakes = append(im.fakes, pkg.Name())
	pkg.MarkComplete()
	im.cache[path] = pkg
	return pkg, nil
}

func main() {
	var ov struct{ Replace map[string]string }
	b, err := os.ReadFile(os.Args[1])
	if err == nil {
		err = json.Unmarshal(b, &ov)
	}
	if err != nil {
		fmt.Println(err)
		os.Exit(2)
	}
	fset := token.NewFileSet()
	im := &imp{root: os.Args[2], overlay: ov.Replace, fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*types.Package{}, other: map[string]int{}}
	for _, p := range os.Args[3:] {
		im.load(modPrefix + p)
	}
	keys := make([]string, 0, len(im.other))
	for k := range im.other {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("not shown: %d errors outside the overlay in %s\n", im.other[k], strings.TrimPrefix(k, modPrefix))
	}
	fmt.Printf("errors in overlay files: %d\n", im.shown)
	if im.shown > 0 {
		os.Exit(1)
	}
}
