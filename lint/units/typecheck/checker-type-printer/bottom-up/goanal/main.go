// Typed call graph of typescript-go's type printer family (research tool, not shipped).
// It type-checks the reference packages from source and writes, for every function declaration of the
// loaded module packages: file, line range, body lines, panic and assert sites, and the functions it references.
// Interface method calls get an edge to every implementation in the loaded packages. A read of a
// function-typed struct field gets an edge to every function that is assigned to that field anywhere.
// usage: goanal <out.json> <root package>...      (package names under internal/, e.g. checker printer)
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

var root = "/workspace/ref/typescript-go/"

type pkgInfo struct {
	path  string
	pkg   *types.Package
	info  *types.Info
	files []*ast.File
}

type imp struct {
	fset  *token.FileSet
	std   types.Importer
	cache map[string]*pkgInfo
	order []*pkgInfo
	errs  map[string]int
}

func (im *imp) Import(path string) (*types.Package, error) { return im.ImportFrom(path, "", 0) }

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
		Instances:  map[*ast.Ident]types.Instance{},
	}
	conf := types.Config{
		Importer: im,
		Error: func(err error) {
			im.errs[path]++
			if im.errs[path] <= 3 || os.Getenv("ALLERR") != "" {
				fmt.Fprintln(os.Stderr, "typeerr:", err)
			}
		},
		FakeImportC: true,
	}
	pkg, _ := conf.Check(path, im.fset, files, info)
	p := &pkgInfo{path: path, pkg: pkg, info: info, files: files}
	im.cache[path] = p
	im.order = append(im.order, p)
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
	if p, ok := im.cache[path]; ok && p != nil {
		return p.pkg, nil
	}
	name := path[strings.LastIndex(path, "/")+1:]
	pkg := types.NewPackage(path, name)
	pkg.MarkComplete()
	im.cache[path] = &pkgInfo{pkg: pkg}
	return pkg, nil
}

type fn struct {
	Id      string   `json:"id"`
	Pkg     string   `json:"pkg"`
	File    string   `json:"file"`
	Recv    string   `json:"recv,omitempty"`
	Name    string   `json:"name"`
	Start   int      `json:"start"`
	End     int      `json:"end"`
	Lines   int      `json:"lines"`
	Panics  []string `json:"panics,omitempty"`
	Calls   []string `json:"calls,omitempty"`
	Std     []string `json:"std,omitempty"`
	Fields  []string `json:"fields,omitempty"`
	calls   map[string]bool
	std     map[string]bool
	fields  map[string]bool
	decl    *ast.FuncDecl
	pi      *pkgInfo
	funcObj *types.Func
}

func recvNameOf(f *types.Func) string {
	sig, ok := f.Type().(*types.Signature)
	if !ok || sig.Recv() == nil {
		return ""
	}
	t := sig.Recv().Type()
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	switch n := t.(type) {
	case *types.Named:
		return n.Obj().Name()
	case *types.Alias:
		return n.Obj().Name()
	}
	return ""
}

func shortPkg(p *types.Package) string {
	return strings.TrimPrefix(strings.TrimPrefix(p.Path(), modPrefix), "internal/")
}

func idOf(f *types.Func) string {
	f = f.Origin()
	r := recvNameOf(f)
	if r != "" {
		return shortPkg(f.Pkg()) + "." + r + "." + f.Name()
	}
	return shortPkg(f.Pkg()) + "." + f.Name()
}

func main() {
	if v := os.Getenv("REF_ROOT"); v != "" {
		root = v
	}
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	outPath := os.Args[1]
	for _, r := range os.Args[2:] {
		im.load(modPrefix + "internal/" + r)
	}
	rel := func(pos token.Pos) (string, int) {
		ps := fset.Position(pos)
		return strings.TrimPrefix(ps.Filename, root+"internal/"), ps.Line
	}
	fns := map[string]*fn{}
	byObj := map[*types.Func]*fn{}
	// pass 1: declarations
	for _, pi := range im.order {
		for _, f := range pi.files {
			for _, d := range f.Decls {
				fd, ok := d.(*ast.FuncDecl)
				if !ok {
					continue
				}
				o, _ := pi.info.Defs[fd.Name].(*types.Func)
				if o == nil {
					continue
				}
				file, start := rel(fd.Pos())
				_, end := rel(fd.End())
				e := &fn{Id: idOf(o), Pkg: shortPkg(o.Pkg()), File: file, Recv: recvNameOf(o), Name: o.Name(), Start: start, End: end, Lines: end - start + 1, calls: map[string]bool{}, std: map[string]bool{}, fields: map[string]bool{}, decl: fd, pi: pi, funcObj: o}
				if prev, dup := fns[e.Id]; dup {
					e.Id = e.Id + "@" + file
					_ = prev
				}
				fns[e.Id] = e
				byObj[o] = e
			}
		}
	}
	// all named types of the loaded module packages, for interface dispatch
	var named []*types.Named
	for _, pi := range im.order {
		if pi.pkg == nil {
			continue
		}
		sc := pi.pkg.Scope()
		for _, n := range sc.Names() {
			if tn, ok := sc.Lookup(n).(*types.TypeName); ok {
				if nt, ok := tn.Type().(*types.Named); ok {
					if _, isIface := nt.Underlying().(*types.Interface); !isIface {
						named = append(named, nt)
					}
				}
			}
		}
	}
	implCache := map[*types.Func][]string{}
	impls := func(m *types.Func) []string {
		if r, ok := implCache[m]; ok {
			return r
		}
		var res []string
		sig := m.Type().(*types.Signature)
		if sig.Recv() != nil {
			if it, ok := sig.Recv().Type().Underlying().(*types.Interface); ok {
				for _, nt := range named {
					if nt.TypeParams().Len() > 0 {
						continue
					}
					var recv types.Type = nt
					if !types.Implements(recv, it) {
						recv = types.NewPointer(nt)
						if !types.Implements(recv, it) {
							continue
						}
					}
					obj, _, _ := types.LookupFieldOrMethod(recv, true, m.Pkg(), m.Name())
					if mf, ok := obj.(*types.Func); ok && mf.Pkg() != nil && strings.HasPrefix(mf.Pkg().Path(), modPrefix) {
						res = append(res, idOf(mf))
					}
				}
			}
		}
		implCache[m] = res
		return res
	}
	// pass 2: function values assigned to function-typed fields and package variables
	assigned := map[types.Object]map[string]bool{}
	funcOfExpr := func(pi *pkgInfo, x ast.Expr) *types.Func {
		for {
			if p, ok := x.(*ast.ParenExpr); ok {
				x = p.X
				continue
			}
			break
		}
		switch v := x.(type) {
		case *ast.Ident:
			if f, ok := pi.info.Uses[v].(*types.Func); ok {
				return f
			}
		case *ast.SelectorExpr:
			if f, ok := pi.info.Uses[v.Sel].(*types.Func); ok {
				return f
			}
		}
		return nil
	}
	note := func(target types.Object, f *types.Func) {
		if target == nil || f == nil || f.Pkg() == nil || !strings.HasPrefix(f.Pkg().Path(), modPrefix) {
			return
		}
		if v, ok := target.(*types.Var); ok {
			target = v.Origin()
		}
		if assigned[target] == nil {
			assigned[target] = map[string]bool{}
		}
		assigned[target][idOf(f)] = true
	}
	for _, pi := range im.order {
		for _, f := range pi.files {
			ast.Inspect(f, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.AssignStmt:
					if len(x.Lhs) == len(x.Rhs) {
						for i, l := range x.Lhs {
							fo := funcOfExpr(pi, x.Rhs[i])
							if fo == nil {
								continue
							}
							switch lv := l.(type) {
							case *ast.SelectorExpr:
								note(pi.info.Uses[lv.Sel], fo)
							case *ast.Ident:
								if o := pi.info.Uses[lv]; o != nil {
									note(o, fo)
								}
							}
						}
					}
				case *ast.KeyValueExpr:
					if k, ok := x.Key.(*ast.Ident); ok {
						if fo := funcOfExpr(pi, x.Value); fo != nil {
							note(pi.info.Uses[k], fo)
						}
					}
				case *ast.ValueSpec:
					if len(x.Names) == len(x.Values) {
						for i, nm := range x.Names {
							if fo := funcOfExpr(pi, x.Values[i]); fo != nil {
								note(pi.info.Defs[nm], fo)
							}
						}
					}
				}
				return true
			})
		}
	}
	// pass 3: edges
	for _, e := range fns {
		if e.decl.Body == nil {
			continue
		}
		pi := e.pi
		ast.Inspect(e.decl.Body, func(n ast.Node) bool {
			id, ok := n.(*ast.Ident)
			if !ok {
				return true
			}
			o := pi.info.Uses[id]
			if o == nil {
				return true
			}
			if o.Pkg() == nil {
				if o.Name() == "panic" {
					_, line := rel(id.Pos())
					e.Panics = append(e.Panics, fmt.Sprintf("panic@%d", line))
				}
				return true
			}
			inMod := strings.HasPrefix(o.Pkg().Path(), modPrefix)
			switch x := o.(type) {
			case *types.Func:
				if !inMod {
					k := o.Pkg().Name() + "." + o.Name()
					if r := recvNameOf(x); r != "" {
						k = o.Pkg().Name() + "." + r + "." + o.Name()
					}
					e.std[k] = true
					return true
				}
				sig := x.Type().(*types.Signature)
				if sig.Recv() != nil {
					if _, isIface := sig.Recv().Type().Underlying().(*types.Interface); isIface {
						for _, t := range impls(x.Origin()) {
							e.calls[t] = true
						}
						e.calls["iface:"+shortPkg(x.Pkg())+"."+ifaceName(sig.Recv().Type())+"."+x.Name()] = true
						return true
					}
				}
				cid := idOf(x)
				e.calls[cid] = true
				if shortPkg(x.Pkg()) == "debug" {
					_, line := rel(id.Pos())
					e.Panics = append(e.Panics, fmt.Sprintf("debug.%s@%d", x.Name(), line))
				}
			case *types.Var:
				if !inMod {
					return true
				}
				v := x.Origin()
				if v.IsField() || v.Parent() == v.Pkg().Scope() {
					if _, isSig := v.Type().Underlying().(*types.Signature); isSig {
						for t := range assigned[v] {
							e.calls[t] = true
						}
						e.fields[shortPkg(v.Pkg())+"."+v.Name()] = true
					}
				}
			}
			return true
		})
	}
	var list []*fn
	for _, e := range fns {
		for k := range e.calls {
			e.Calls = append(e.Calls, k)
		}
		for k := range e.std {
			e.Std = append(e.Std, k)
		}
		for k := range e.fields {
			e.Fields = append(e.Fields, k)
		}
		sort.Strings(e.Calls)
		sort.Strings(e.Std)
		sort.Strings(e.Fields)
		list = append(list, e)
	}
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.Pkg != b.Pkg {
			return a.Pkg < b.Pkg
		}
		if a.File != b.File {
			return a.File < b.File
		}
		return a.Start < b.Start
	})
	out, _ := json.MarshalIndent(list, "", " ")
	if err := os.WriteFile(outPath, out, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var keys []string
	for k, v := range im.errs {
		keys = append(keys, fmt.Sprintf("%s=%d", strings.TrimPrefix(k, modPrefix), v))
	}
	sort.Strings(keys)
	fmt.Fprintln(os.Stderr, "type errors per package:", strings.Join(keys, " "))
	fmt.Fprintln(os.Stderr, "functions:", len(list))
}

func ifaceName(t types.Type) string {
	switch n := t.(type) {
	case *types.Named:
		return n.Obj().Name()
	case *types.Alias:
		return n.Obj().Name()
	}
	return "?"
}
