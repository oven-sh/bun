package main

import (
	"encoding/json"
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
	}
	conf := types.Config{
		Importer: im,
		Error: func(err error) {
			im.errs[path]++
			if im.errs[path] <= 3 || strings.HasSuffix(path, "checker") || strings.HasSuffix(path, "/ast") || strings.HasSuffix(path, "/core") || strings.HasSuffix(path, "binder") || strings.HasSuffix(path, "collections") {
				fmt.Fprintln(os.Stderr, "typeerr:", err)
			}
		},
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
	if len(s) > 200 {
		s = s[:200] + "..."
	}
	return s
}

func recvTypeName(t types.Type) string {
	for {
		switch x := t.(type) {
		case *types.Pointer:
			t = x.Elem()
			continue
		case *types.Named:
			return x.Obj().Name()
		case *types.Alias:
			return x.Obj().Name()
		}
		return t.String()
	}
}

func objName(o *types.Func) string {
	sig, _ := o.Type().(*types.Signature)
	pk := ""
	if o.Pkg() != nil {
		pk = o.Pkg().Name()
	}
	if sig != nil && sig.Recv() != nil {
		return pk + "." + recvTypeName(sig.Recv().Type()) + "." + o.Name()
	}
	return pk + "." + o.Name()
}

type Site struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

type Write struct {
	Line  int    `json:"line"`
	Kind  string `json:"kind"`
	Field string `json:"field"`
	Base  string `json:"base"`
	Text  string `json:"text"`
}

type Fn struct {
	Pkg      string   `json:"pkg"`
	File     string   `json:"file"`
	Name     string   `json:"name"`
	Start    int      `json:"start"`
	BodyFrom int      `json:"decl"`
	End      int      `json:"end"`
	Callees  []string `json:"callees"`
	Program  []Site   `json:"program"`
	Diags    []string `json:"diags"`
	Panics   []Site   `json:"panics"`
	Asserts  []Site   `json:"asserts"`
	Tracer   []Site   `json:"tracer"`
	SymW     []Write  `json:"symw"`
	Links    []string `json:"links"`
	Fields   []string `json:"fields"`
	MapRange []Site   `json:"maprange"`
	Closures int      `json:"closures"`
}

func isSymbolPtr(t types.Type) bool {
	if t == nil {
		return false
	}
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	if a, ok := t.(*types.Alias); ok {
		t = types.Unalias(a)
	}
	n, ok := t.(*types.Named)
	if !ok {
		return false
	}
	return n.Obj().Name() == "Symbol" && n.Obj().Pkg() != nil && n.Obj().Pkg().Name() == "ast"
}

func namedIs(t types.Type, pkg, name string) bool {
	if t == nil {
		return false
	}
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	t = types.Unalias(t)
	n, ok := t.(*types.Named)
	if !ok {
		return false
	}
	return n.Obj().Name() == name && n.Obj().Pkg() != nil && n.Obj().Pkg().Name() == pkg
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	out := os.Args[1]
	var fns []*Fn
	for _, t := range os.Args[2:] {
		p := im.load(modPrefix + "internal/" + t)
		if p == nil {
			continue
		}
		info := p.info
		for _, f := range p.files {
			fname := strings.TrimPrefix(fset.Position(f.Pos()).Filename, root+"internal/")
			for _, d := range f.Decls {
				fd, ok := d.(*ast.FuncDecl)
				if !ok || fd.Body == nil {
					continue
				}
				fn := &Fn{Pkg: t, File: fname}
				obj, _ := info.Defs[fd.Name].(*types.Func)
				if obj != nil {
					fn.Name = objName(obj)
				} else {
					fn.Name = t + "." + fd.Name.Name
				}
				fn.Start = fset.Position(fd.Pos()).Line
				if fd.Doc != nil {
					fn.Start = fset.Position(fd.Doc.Pos()).Line
				}
				fn.BodyFrom = fset.Position(fd.Pos()).Line
				fn.End = fset.Position(fd.End()).Line
				callees := map[string]bool{}
				diags := map[string]bool{}
				links := map[string]bool{}
				fields := map[string]bool{}
				line := func(n ast.Node) int { return fset.Position(n.Pos()).Line }
				ast.Inspect(fd.Body, func(n ast.Node) bool {
					switch x := n.(type) {
					case *ast.FuncLit:
						fn.Closures++
					case *ast.Ident:
						if o, ok := info.Uses[x]; ok {
							switch oo := o.(type) {
							case *types.Func:
								if oo.Pkg() != nil && strings.HasPrefix(oo.Pkg().Path(), modPrefix) {
									callees[objName(oo)] = true
								}
							case *types.Var:
								if oo.Pkg() != nil && oo.Pkg().Name() == "diagnostics" && !oo.IsField() {
									diags[oo.Name()] = true
								}
								if oo.IsField() && oo.Pkg() != nil && oo.Pkg().Name() == "checker" {
									// field use: record Checker fields only via selection below
								}
							}
						}
					case *ast.SelectorExpr:
						if sel, ok := info.Selections[x]; ok {
							rt := sel.Recv()
							if sel.Kind() == types.FieldVal {
								if namedIs(rt, "checker", "Checker") {
									fields[x.Sel.Name] = true
									if x.Sel.Name == "tracer" {
										fn.Tracer = append(fn.Tracer, Site{line(x), exprString(fset, x)})
									}
									if strings.HasSuffix(x.Sel.Name, "Links") || strings.HasSuffix(x.Sel.Name, "links") {
										links[x.Sel.Name] = true
									}
								}
							} else {
								if namedIs(rt, "checker", "Program") || namedIs(rt, "checker", "Host") {
									fn.Program = append(fn.Program, Site{line(x), x.Sel.Name})
								} else if it, ok := rt.Underlying().(*types.Interface); ok && it != nil {
									// method on interface reached through c.program
									if inner, ok := x.X.(*ast.SelectorExpr); ok && inner.Sel.Name == "program" {
										fn.Program = append(fn.Program, Site{line(x), x.Sel.Name})
									}
								}
							}
						}
					case *ast.CallExpr:
						if id, ok := x.Fun.(*ast.Ident); ok && id.Name == "panic" {
							fn.Panics = append(fn.Panics, Site{line(x), exprString(fset, x)})
						}
						if se, ok := x.Fun.(*ast.SelectorExpr); ok {
							if pid, ok := se.X.(*ast.Ident); ok {
								if pn, ok := info.Uses[pid].(*types.PkgName); ok && pn.Imported().Name() == "debug" {
									fn.Asserts = append(fn.Asserts, Site{line(x), exprString(fset, x)})
								}
								if pn, ok := info.Uses[pid].(*types.PkgName); ok && pn.Imported().Name() == "binder" && se.Sel.Name == "SetValueDeclaration" {
									base := ""
									if len(x.Args) > 0 {
										base = exprString(fset, x.Args[0])
									}
									fn.SymW = append(fn.SymW, Write{line(x), "call", "ValueDeclaration", base, exprString(fset, x)})
								}
								if pn, ok := info.Uses[pid].(*types.PkgName); ok && pn.Imported().Name() == "ast" && se.Sel.Name == "GetSymbolTable" {
									base := ""
									if len(x.Args) > 0 {
										base = exprString(fset, x.Args[0])
									}
									fn.SymW = append(fn.SymW, Write{line(x), "gettable", "", base, exprString(fset, x)})
								}
							}
						}
					case *ast.AssignStmt:
						for _, l := range x.Lhs {
							recordWrite(fset, info, fn, l, x, "assign")
						}
					case *ast.IncDecStmt:
						recordWrite(fset, info, fn, x.X, x, "incdec")
					case *ast.RangeStmt:
						if tv := info.TypeOf(x.X); tv != nil {
							if _, ok := tv.Underlying().(*types.Map); ok {
								fn.MapRange = append(fn.MapRange, Site{line(x), exprString(fset, x.X)})
							}
						}
					}
					return true
				})
				for k := range callees {
					fn.Callees = append(fn.Callees, k)
				}
				sort.Strings(fn.Callees)
				for k := range diags {
					fn.Diags = append(fn.Diags, k)
				}
				sort.Strings(fn.Diags)
				for k := range links {
					fn.Links = append(fn.Links, k)
				}
				sort.Strings(fn.Links)
				for k := range fields {
					fn.Fields = append(fn.Fields, k)
				}
				sort.Strings(fn.Fields)
				fns = append(fns, fn)
			}
		}
	}
	b, _ := json.Marshal(fns)
	os.WriteFile(out, b, 0o644)
	for k, v := range im.errs {
		fmt.Fprintln(os.Stderr, "errors", k, v)
	}
}

func recordWrite(fset *token.FileSet, info *types.Info, fn *Fn, l ast.Expr, stmt ast.Node, kind string) {
	line := fset.Position(stmt.Pos()).Line
	switch x := l.(type) {
	case *ast.SelectorExpr:
		bt := info.TypeOf(x.X)
		if isSymbolPtr(bt) {
			fn.SymW = append(fn.SymW, Write{line, kind, x.Sel.Name, exprString(fset, x.X), exprString(fset, stmt)})
		}
	case *ast.IndexExpr:
		bt := info.TypeOf(x.X)
		if bt != nil && namedIs(bt, "ast", "SymbolTable") {
			fn.SymW = append(fn.SymW, Write{line, kind + "-table", "[]", exprString(fset, x.X), exprString(fset, stmt)})
		} else if se, ok := x.X.(*ast.SelectorExpr); ok {
			if isSymbolPtr(info.TypeOf(se.X)) {
				fn.SymW = append(fn.SymW, Write{line, kind + "-index", se.Sel.Name, exprString(fset, se.X), exprString(fset, stmt)})
			}
		}
	}
}
