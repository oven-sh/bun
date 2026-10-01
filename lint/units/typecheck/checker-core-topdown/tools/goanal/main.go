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
			if im.errs[path] <= 3 || strings.HasSuffix(path, "internal/checker") || strings.HasSuffix(path, "internal/binder") {
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

type Site struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	Kind string `json:"kind,omitempty"`
}

type Callee struct {
	Name string `json:"name"`
	Pkg  string `json:"pkg"`
	File string `json:"file,omitempty"`
	Line int    `json:"line,omitempty"`
	N    int    `json:"n"`
	Call bool   `json:"call"`
}

type Fn struct {
	Pkg      string   `json:"pkg"`
	File     string   `json:"file"`
	Name     string   `json:"name"`
	Recv     string   `json:"recv"`
	Start    int      `json:"start"`
	End      int      `json:"end"`
	Callees  []Callee `json:"callees"`
	Panics   []Site   `json:"panics,omitempty"`
	Asserts  []Site   `json:"asserts,omitempty"`
	Diags    []Site   `json:"diags,omitempty"`
	Program  []Site   `json:"program,omitempty"`
	Tracer   []Site   `json:"tracer,omitempty"`
	SymWrite []Site   `json:"symwrite,omitempty"`
	MapRange []Site   `json:"maprange,omitempty"`
	Defers   []Site   `json:"defers,omitempty"`
	FuncLits int      `json:"funclits,omitempty"`
	CFields  []string `json:"cfields,omitempty"`
	Casts    []Site   `json:"casts,omitempty"`
	Index    []Site   `json:"index,omitempty"`
}

func typeStr(t types.Type) string {
	if t == nil {
		return "?"
	}
	return types.TypeString(t, func(p *types.Package) string { return p.Name() })
}

func isNamed(t types.Type, pkg, name string) bool {
	if t == nil {
		return false
	}
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	n, ok := t.(*types.Named)
	if !ok {
		if a, ok2 := t.(*types.Alias); ok2 {
			return isNamed(types.Unalias(a), pkg, name)
		}
		return false
	}
	o := n.Obj()
	return o != nil && o.Name() == name && o.Pkg() != nil && o.Pkg().Name() == pkg
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	out := os.Args[1]
	targets := os.Args[2:]
	var fns []*Fn
	for _, t := range targets {
		p := im.load(modPrefix + "internal/" + t)
		if p == nil {
			continue
		}
		for _, f := range p.files {
			fname := strings.TrimPrefix(fset.Position(f.Pos()).Filename, root+"internal/")
			for _, d := range f.Decls {
				fd, ok := d.(*ast.FuncDecl)
				if !ok {
					continue
				}
				fn := &Fn{Pkg: t, File: fname, Name: fd.Name.Name}
				if fd.Recv != nil && len(fd.Recv.List) > 0 {
					var sb strings.Builder
					printer.Fprint(&sb, token.NewFileSet(), fd.Recv.List[0].Type)
					fn.Recv = sb.String()
				}
				fn.Start = fset.Position(fd.Pos()).Line
				if fd.Doc != nil {
					fn.Start = fset.Position(fd.Doc.Pos()).Line
				}
				fn.End = fset.Position(fd.End()).Line
				callees := map[string]*Callee{}
				cfields := map[string]bool{}
				callFuns := map[ast.Expr]bool{}
				if fd.Body != nil {
					ast.Inspect(fd.Body, func(n ast.Node) bool {
						if ce, ok := n.(*ast.CallExpr); ok {
							callFuns[ast.Unparen(ce.Fun)] = true
							if ix, ok := ast.Unparen(ce.Fun).(*ast.IndexExpr); ok {
								callFuns[ix.X] = true
							}
							if ix, ok := ast.Unparen(ce.Fun).(*ast.IndexListExpr); ok {
								callFuns[ix.X] = true
							}
						}
						return true
					})
				}
				addCallee := func(obj types.Object, isCall bool) {
					fo, ok := obj.(*types.Func)
					if !ok {
						return
					}
					fo = fo.Origin()
					name := fo.Name()
					pk := ""
					if fo.Pkg() != nil {
						pk = fo.Pkg().Name()
					}
					sig, _ := fo.Type().(*types.Signature)
					if sig != nil && sig.Recv() != nil {
						rt := sig.Recv().Type()
						if ptr, ok := rt.(*types.Pointer); ok {
							rt = ptr.Elem()
						}
						rn := typeStr(rt)
						if i := strings.Index(rn, "["); i >= 0 {
							rn = rn[:i]
						}
						if i := strings.LastIndex(rn, "."); i >= 0 {
							rn = rn[i+1:]
						}
						name = rn + "." + name
					}
					key := pk + "." + name
					c := callees[key]
					if c == nil {
						pos := fset.Position(fo.Pos())
						c = &Callee{Name: name, Pkg: pk, File: strings.TrimPrefix(pos.Filename, root+"internal/"), Line: pos.Line}
						callees[key] = c
					}
					c.N++
					if isCall {
						c.Call = true
					}
				}
				line := func(n ast.Node) int { return fset.Position(n.Pos()).Line }
				if fd.Body != nil {
					ast.Inspect(fd.Body, func(n ast.Node) bool {
						switch x := n.(type) {
						case *ast.FuncLit:
							fn.FuncLits++
						case *ast.DeferStmt:
							fn.Defers = append(fn.Defers, Site{Line: line(x), Text: exprString(fset, x.Call)})
						case *ast.RangeStmt:
							tv := p.info.TypeOf(x.X)
							if tv != nil {
								if _, ok := tv.Underlying().(*types.Map); ok {
									fn.MapRange = append(fn.MapRange, Site{Line: line(x), Text: exprString(fset, x.X), Kind: typeStr(tv)})
								}
							}
						case *ast.Ident:
							if obj := p.info.Uses[x]; obj != nil {
								if _, ok := obj.(*types.Func); ok {
									addCallee(obj, callFuns[ast.Expr(x)])
								}
							}
						case *ast.SelectorExpr:
							if sel := p.info.Selections[x]; sel != nil {
								if sel.Kind() == types.MethodVal || sel.Kind() == types.MethodExpr {
									addCallee(sel.Obj(), callFuns[ast.Expr(x)])
								}
								if sel.Kind() == types.FieldVal {
									xt := p.info.TypeOf(x.X)
									if isNamed(xt, "checker", "Checker") {
										cfields[x.Sel.Name] = true
										if x.Sel.Name == "tracer" {
											fn.Tracer = append(fn.Tracer, Site{Line: line(x), Text: exprString(fset, x)})
										}
									}
								}
								// method on Program interface
								xt := p.info.TypeOf(x.X)
								if isNamed(xt, "checker", "Program") {
									fn.Program = append(fn.Program, Site{Line: line(x), Text: x.Sel.Name})
								}
							} else {
								// qualified identifier pkg.Name
								if obj := p.info.Uses[x.Sel]; obj != nil {
									if _, ok := obj.(*types.Func); ok {
										addCallee(obj, callFuns[ast.Expr(x)])
									}
									if obj.Pkg() != nil && obj.Pkg().Name() == "diagnostics" {
										if _, ok := obj.(*types.Var); ok {
											fn.Diags = append(fn.Diags, Site{Line: line(x), Text: x.Sel.Name})
										}
									}
									if obj.Pkg() != nil && obj.Pkg().Name() == "tracing" {
										fn.Tracer = append(fn.Tracer, Site{Line: line(x), Text: exprString(fset, x)})
									}
									if obj.Pkg() != nil && obj.Pkg().Name() == "debug" {
										fn.Asserts = append(fn.Asserts, Site{Line: line(x), Text: x.Sel.Name})
									}
								}
							}
							// selections also on Uses for methods of interface Program
							if sel := p.info.Selections[x]; sel != nil && sel.Kind() == types.MethodVal {
								xt := p.info.TypeOf(x.X)
								if isNamed(xt, "checker", "Program") {
									// recorded above
								}
							}
						case *ast.CallExpr:
							if id, ok := ast.Unparen(x.Fun).(*ast.Ident); ok && id.Name == "panic" {
								if _, isB := p.info.Uses[id].(*types.Builtin); isB {
									fn.Panics = append(fn.Panics, Site{Line: line(x), Text: exprString(fset, x)})
								}
							}
							if se, ok := ast.Unparen(x.Fun).(*ast.SelectorExpr); ok {
								if id, ok := se.X.(*ast.Ident); ok && id.Name == "debug" {
									for i := range fn.Asserts {
										if fn.Asserts[i].Line == line(se) && fn.Asserts[i].Kind == "" {
											fn.Asserts[i].Kind = exprString(fset, x)
										}
									}
								}
							}
						case *ast.TypeAssertExpr:
							if x.Type != nil {
								fn.Casts = append(fn.Casts, Site{Line: line(x), Text: exprString(fset, x)})
							}
						case *ast.AssignStmt:
							for _, lhs := range x.Lhs {
								checkSymWrite(p, fset, fn, lhs, x)
							}
						case *ast.IncDecStmt:
							checkSymWrite(p, fset, fn, x.X, x)
						}
						return true
					})
				}
				for _, c := range callees {
					fn.Callees = append(fn.Callees, *c)
				}
				sort.Slice(fn.Callees, func(i, j int) bool {
					if fn.Callees[i].Pkg != fn.Callees[j].Pkg {
						return fn.Callees[i].Pkg < fn.Callees[j].Pkg
					}
					return fn.Callees[i].Name < fn.Callees[j].Name
				})
				for k := range cfields {
					fn.CFields = append(fn.CFields, k)
				}
				sort.Strings(fn.CFields)
				fns = append(fns, fn)
			}
		}
	}
	b, _ := json.Marshal(fns)
	os.WriteFile(out, b, 0o644)
	var keys []string
	for k, v := range im.errs {
		keys = append(keys, fmt.Sprintf("%s=%d", strings.TrimPrefix(k, modPrefix), v))
	}
	sort.Strings(keys)
	fmt.Fprintln(os.Stderr, "type errors per package:", strings.Join(keys, " "))
}

// A write whose target is a field of ast.Symbol, or an element of a map or slice held in such a field.
func checkSymWrite(p *pkgInfo, fset *token.FileSet, fn *Fn, lhs ast.Expr, stmt ast.Node) {
	e := ast.Unparen(lhs)
	kind := "field"
	for {
		switch x := e.(type) {
		case *ast.IndexExpr:
			e = ast.Unparen(x.X)
			kind = "element"
			continue
		case *ast.StarExpr:
			e = ast.Unparen(x.X)
			continue
		}
		break
	}
	se, ok := e.(*ast.SelectorExpr)
	if !ok {
		// map element write where the map is a SymbolTable variable
		if kind == "element" {
			tv := p.info.TypeOf(e)
			if tv != nil && isNamed(tv, "ast", "SymbolTable") {
				fn.SymWrite = append(fn.SymWrite, Site{Line: fset.Position(stmt.Pos()).Line, Text: exprString(fset, stmt), Kind: "table-element"})
			}
		}
		return
	}
	sel := p.info.Selections[se]
	if sel == nil || sel.Kind() != types.FieldVal {
		return
	}
	xt := p.info.TypeOf(se.X)
	if isNamed(xt, "ast", "Symbol") {
		fn.SymWrite = append(fn.SymWrite, Site{Line: fset.Position(stmt.Pos()).Line, Text: exprString(fset, stmt), Kind: kind + ":" + se.Sel.Name})
		return
	}
	if kind == "element" {
		tv := p.info.TypeOf(e)
		if tv != nil && isNamed(tv, "ast", "SymbolTable") {
			fn.SymWrite = append(fn.SymWrite, Site{Line: fset.Position(stmt.Pos()).Line, Text: exprString(fset, stmt), Kind: "table-element"})
		}
	}
}
