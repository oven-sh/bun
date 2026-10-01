package main

import (
	"fmt"
	"go/ast"
	"go/build/constraint"
	"go/importer"
	"go/parser"
	"go/printer"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const modPrefix = "github.com/microsoft/typescript-go/"
const root = "/workspace/ref/typescript-go/"

type pkgInfo struct {
	pkg   *types.Package
	info  *types.Info
	files []*ast.File
}

type imp struct {
	fset  *token.FileSet
	std   types.Importer
	cache map[string]*pkgInfo
	errs  map[string]int
}

func (im *imp) Import(path string) (*types.Package, error) {
	return im.ImportFrom(path, "", 0)
}

func matchFile(name string, src []byte) bool {
	if strings.HasSuffix(name, "_test.go") {
		return false
	}
	base := strings.TrimSuffix(name, ".go")
	for _, os_ := range []string{"windows", "darwin", "js", "wasm", "freebsd", "plan9", "wasip1"} {
		if strings.HasSuffix(base, "_"+os_) {
			return false
		}
	}
	for _, line := range strings.Split(string(src), "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "package ") {
			break
		}
		if constraint.IsGoBuild(l) {
			x, err := constraint.Parse(l)
			if err == nil {
				ok := x.Eval(func(tag string) bool {
					return tag == "linux" || tag == "amd64" || tag == "unix" || strings.HasPrefix(tag, "go1.")
				})
				if !ok {
					return false
				}
			}
		}
	}
	return true
}

func (im *imp) load(path string) *pkgInfo {
	if p, ok := im.cache[path]; ok {
		return p
	}
	im.cache[path] = nil
	dir := root + strings.TrimPrefix(path, modPrefix)
	ents, err := os.ReadDir(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read", dir, err)
		return nil
	}
	var files []*ast.File
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		fn := filepath.Join(dir, e.Name())
		src, _ := os.ReadFile(fn)
		if !matchFile(e.Name(), src) {
			continue
		}
		f, err := parser.ParseFile(im.fset, fn, src, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			fmt.Fprintln(os.Stderr, "parse error", fn, err)
			if f == nil {
				continue
			}
		}
		files = append(files, f)
	}
	info := &types.Info{
		Types:      map[ast.Expr]types.TypeAndValue{},
		Defs:       map[*ast.Ident]types.Object{},
		Uses:       map[*ast.Ident]types.Object{},
		Selections: map[*ast.SelectorExpr]*types.Selection{},
	}
	conf := types.Config{
		Importer:    im,
		Error:       func(err error) { im.errs[path]++; if im.errs[path] <= 5 { fmt.Fprintln(os.Stderr, "typeerr:", err) } },
		FakeImportC: true,
		GoVersion:   "go1.24",
	}
	pkg, _ := conf.Check(path, im.fset, files, info)
	p := &pkgInfo{pkg: pkg, info: info, files: files}
	im.cache[path] = p
	return p
}

func (im *imp) ImportFrom(path, dir string, mode types.ImportMode) (*types.Package, error) {
	if strings.HasPrefix(path, modPrefix) {
		p := im.load(path)
		if p == nil || p.pkg == nil {
			return nil, fmt.Errorf("cannot load %s", path)
		}
		return p.pkg, nil
	}
	if !strings.Contains(strings.Split(path, "/")[0], ".") {
		return im.std.Import(path)
	}
	// third-party: fake
	if p, ok := im.cache[path]; ok && p != nil {
		return p.pkg, nil
	}
	name := path[strings.LastIndex(path, "/")+1:]
	pkg := types.NewPackage(path, name)
	pkg.MarkComplete()
	im.cache[path] = &pkgInfo{pkg: pkg}
	return pkg, nil
}


func exprString(fset *token.FileSet, e ast.Node) string {
	var sb strings.Builder
	printer.Fprint(&sb, fset, e)
	s := sb.String()
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 140 {
		s = s[:140] + "..."
	}
	return s
}

func qual(p *types.Package) string { return p.Name() }

func isMessagePtr(t types.Type) bool {
	pt, ok := t.(*types.Pointer)
	if !ok {
		return false
	}
	n, ok := pt.Elem().(*types.Named)
	if !ok {
		return false
	}
	return n.Obj().Name() == "Message" && n.Obj().Pkg() != nil && n.Obj().Pkg().Name() == "diagnostics"
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	mode := os.Args[1]
	targets := os.Args[2:]
	typeCount := map[string]int{}
	typeExample := map[string]string{}
	calleeCount := map[string]int{}
	for _, t := range targets {
		p := im.load(modPrefix + "internal/" + t)
		if p == nil {
			continue
		}
		rel := func(pos token.Pos) string {
			ps := fset.Position(pos)
			return strings.TrimPrefix(ps.Filename, root+"internal/") + ":" + fmt.Sprint(ps.Line)
		}
		for _, f := range p.files {
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				tv := p.info.TypeOf(call.Fun)
				if tv == nil {
					return true
				}
				sig, ok := tv.Underlying().(*types.Signature)
				if !ok || !sig.Variadic() {
					return true
				}
				params := sig.Params()
				last := params.At(params.Len() - 1)
				sl, ok := last.Type().(*types.Slice)
				if !ok {
					return true
				}
				if it, ok := sl.Elem().Underlying().(*types.Interface); !ok || it.NumMethods() != 0 {
					return true
				}
				hasMsg := false
				for i := 0; i < params.Len()-1; i++ {
					if isMessagePtr(params.At(i).Type()) {
						hasMsg = true
					}
				}
				if !hasMsg {
					return true
				}
				callee := exprString(fset, call.Fun)
				calleeCount[t+":"+callee]++
				fixed := params.Len() - 1
				if call.Ellipsis.IsValid() {
					typeCount["<spread []any>"]++
					if mode == "list" {
						fmt.Printf("%s\t%s\tSPREAD\t%s\n", rel(call.Pos()), callee, exprString(fset, call.Args[len(call.Args)-1]))
					}
					return true
				}
				for i := fixed; i < len(call.Args); i++ {
					a := call.Args[i]
					at := p.info.TypeOf(a)
					ts := "<unknown>"
					if at != nil {
						ts = types.TypeString(at, qual)
						if tvv, ok := p.info.Types[a]; ok && tvv.Value != nil {
							ts = ts + " (const)"
						}
					}
					typeCount[ts]++
					if _, ok := typeExample[ts]; !ok {
						typeExample[ts] = rel(a.Pos()) + "  " + exprString(fset, a)
					}
					if mode == "list" || (mode == "odd" && !strings.HasPrefix(ts, "string") && !strings.HasPrefix(ts, "untyped string")) {
						fmt.Printf("%s\t%s\t%s\t%s\n", rel(a.Pos()), callee, ts, exprString(fset, a))
					}
				}
				return true
			})
		}
	}
	if mode == "summary" || mode == "odd" {
		var keys []string
		for k := range typeCount {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return typeCount[keys[i]] > typeCount[keys[j]] })
		fmt.Println("=== arg static types ===")
		for _, k := range keys {
			fmt.Printf("%6d  %-40s e.g. %s\n", typeCount[k], k, typeExample[k])
		}
	}
	if mode == "summary" {
		var keys []string
		for k := range calleeCount {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return calleeCount[keys[i]] > calleeCount[keys[j]] })
		fmt.Println("=== callees ===")
		for _, k := range keys {
			fmt.Printf("%6d  %s\n", calleeCount[k], k)
		}
	}
	var keys []string
	for k, v := range im.errs {
		keys = append(keys, fmt.Sprintf("%s=%d", strings.TrimPrefix(k, modPrefix), v))
	}
	sort.Strings(keys)
	fmt.Fprintln(os.Stderr, "type errors per package:", strings.Join(keys, " "))
}
