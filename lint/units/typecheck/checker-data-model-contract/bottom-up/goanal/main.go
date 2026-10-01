// Analyses of typescript-go for the checker data model. Loader after ../../conventions-scratch/goanal/main.go.
// usage: go run . <mode> <package>...      (packages are directories under internal/, e.g. checker)
//   slicewrites   slices that are written in place, with the places where the same slice escapes before the write
//   same          the arguments of every core.Same call with their types
//   funcvalues    method values and function literals that are stored (assigned to a field, put in a composite literal, returned)
//   loops         for statements without a condition, and for statements whose condition does not mention a counter
//   structs       every struct type of the package with its fields
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
		Importer: im,
		Error: func(err error) {
			im.errs[path]++
			if im.errs[path] <= 3 {
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
	s := strings.Join(strings.Fields(sb.String()), " ")
	if len(s) > 140 {
		s = s[:140] + "..."
	}
	return s
}

func funcName(fd *ast.FuncDecl) string {
	if fd == nil {
		return "<toplevel>"
	}
	if fd.Recv != nil && len(fd.Recv.List) > 0 {
		var sb strings.Builder
		printer.Fprint(&sb, token.NewFileSet(), fd.Recv.List[0].Type)
		return "(" + sb.String() + ")." + fd.Name.Name
	}
	return fd.Name.Name
}

func shortType(t types.Type) string {
	if t == nil {
		return "?"
	}
	return types.TypeString(t, func(p *types.Package) string { return p.Name() })
}

func isSlice(t types.Type) bool {
	if t == nil {
		return false
	}
	_, ok := t.Underlying().(*types.Slice)
	return ok
}

type event struct {
	line int
	what string
}

type varInfo struct {
	name    string
	kind    string
	typ     string
	decl    int
	writes  []event
	escapes []event
}

func calleeName(fset *token.FileSet, call *ast.CallExpr) string {
	return exprString(fset, call.Fun)
}

// Calls that read their slice argument and keep nothing.
func pureCallee(name string) bool {
	for _, p := range []string{"len", "cap", "append", "copy", "slices.", "core.", "min", "max", "sort.", "strings.", "debug.", "fmt."} {
		if name == strings.TrimSuffix(p, ".") || strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

func slicewrites(fset *token.FileSet, p *pkgInfo, rel func(token.Pos) string, line func(token.Pos) int) {
	for _, f := range p.files {
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			vars := map[types.Object]*varInfo{}
			fields := map[string]*varInfo{}
			params := map[types.Object]bool{}
			if fd.Type.Params != nil {
				for _, fl := range fd.Type.Params.List {
					for _, n := range fl.Names {
						if o := p.info.Defs[n]; o != nil {
							params[o] = true
						}
					}
				}
			}
			get := func(e ast.Expr) *varInfo {
				for {
					if pe, ok := e.(*ast.ParenExpr); ok {
						e = pe.X
						continue
					}
					if se, ok := e.(*ast.SliceExpr); ok {
						e = se.X
						continue
					}
					break
				}
				switch x := e.(type) {
				case *ast.Ident:
					o := p.info.Uses[x]
					if o == nil {
						o = p.info.Defs[x]
					}
					if o == nil || !isSlice(o.Type()) {
						return nil
					}
					if _, isVar := o.(*types.Var); !isVar {
						return nil
					}
					v := vars[o]
					if v == nil {
						kind := "local"
						if params[o] {
							kind = "param"
						} else if o.Parent() == p.pkg.Scope() {
							kind = "global"
						}
						v = &varInfo{name: x.Name, kind: kind, typ: shortType(o.Type()), decl: line(o.Pos())}
						vars[o] = v
					}
					return v
				case *ast.SelectorExpr:
					if !isSlice(p.info.TypeOf(x)) {
						return nil
					}
					key := exprString(fset, x)
					v := fields[key]
					if v == nil {
						v = &varInfo{name: key, kind: "field", typ: shortType(p.info.TypeOf(x))}
						fields[key] = v
					}
					return v
				case *ast.CallExpr:
					if !isSlice(p.info.TypeOf(x)) {
						return nil
					}
					key := exprString(fset, x)
					v := fields[key]
					if v == nil {
						v = &varInfo{name: key, kind: "call", typ: shortType(p.info.TypeOf(x))}
						fields[key] = v
					}
					return v
				}
				return nil
			}
			write := func(e ast.Expr, pos token.Pos, what string) {
				if v := get(e); v != nil {
					v.writes = append(v.writes, event{line(pos), what})
				}
			}
			escape := func(e ast.Expr, pos token.Pos, what string) {
				if id, ok := e.(*ast.Ident); ok {
					if v := get(id); v != nil && v.kind != "field" {
						v.escapes = append(v.escapes, event{line(pos), what})
					}
				} else if se, ok := e.(*ast.SliceExpr); ok {
					if v := get(se.X); v != nil && v.kind != "field" && v.kind != "call" {
						v.escapes = append(v.escapes, event{line(pos), what + " (subslice)"})
					}
				}
			}
			lhsWrite := func(lhs ast.Expr, pos token.Pos) {
				switch x := lhs.(type) {
				case *ast.IndexExpr:
					if isSlice(p.info.TypeOf(x.X)) {
						write(x.X, pos, "x[i]=")
					}
				case *ast.SelectorExpr:
					if ie, ok := x.X.(*ast.IndexExpr); ok && isSlice(p.info.TypeOf(ie.X)) {
						if _, isPtr := p.info.TypeOf(ie).Underlying().(*types.Pointer); !isPtr {
							write(ie.X, pos, "x[i].f=")
						}
					}
				}
			}
			depth := 0
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.FuncLit:
					depth++
					ast.Inspect(x.Body, func(m ast.Node) bool {
						if id, ok := m.(*ast.Ident); ok {
							o := p.info.Uses[id]
							if o != nil && isSlice(o.Type()) && o.Pos() < x.Pos() {
								if v := get(id); v != nil && v.kind != "field" {
									v.escapes = append(v.escapes, event{line(x.Pos()), "closure"})
								}
							}
						}
						return true
					})
					depth--
				case *ast.AssignStmt:
					for _, l := range x.Lhs {
						lhsWrite(l, x.Pos())
					}
					for i, r := range x.Rhs {
						if i < len(x.Lhs) {
							switch l := x.Lhs[i].(type) {
							case *ast.SelectorExpr:
								escape(r, x.Pos(), "stored in "+exprString(fset, l))
							case *ast.IndexExpr:
								escape(r, x.Pos(), "stored in "+exprString(fset, l))
							}
						}
					}
				case *ast.IncDecStmt:
					lhsWrite(x.X, x.Pos())
				case *ast.CompositeLit:
					for _, el := range x.Elts {
						v := el
						if kv, ok := el.(*ast.KeyValueExpr); ok {
							v = kv.Value
						}
						escape(v, x.Pos(), "literal "+shortType(p.info.TypeOf(x)))
					}
				case *ast.ReturnStmt:
					for _, r := range x.Results {
						escape(r, x.Pos(), "return")
					}
				case *ast.CallExpr:
					name := calleeName(fset, x)
					switch name {
					case "copy":
						if len(x.Args) > 0 {
							write(x.Args[0], x.Pos(), "copy(x,..)")
						}
					case "slices.Sort", "slices.SortFunc", "slices.SortStableFunc", "slices.Reverse", "sort.Slice", "sort.SliceStable", "sort.Strings", "sort.Ints":
						if len(x.Args) > 0 {
							write(x.Args[0], x.Pos(), name)
						}
					}
					if !pureCallee(name) {
						for _, a := range x.Args {
							escape(a, x.Pos(), "arg of "+name)
						}
					}
				}
				return true
			})
			all := []*varInfo{}
			for _, v := range vars {
				all = append(all, v)
			}
			for _, v := range fields {
				all = append(all, v)
			}
			sort.Slice(all, func(i, j int) bool { return all[i].name < all[j].name })
			for _, v := range all {
				if len(v.writes) == 0 {
					continue
				}
				lastWrite := 0
				ws := []string{}
				for _, w := range v.writes {
					if w.line > lastWrite {
						lastWrite = w.line
					}
					ws = append(ws, fmt.Sprintf("%d %s", w.line, w.what))
				}
				before := []string{}
				for _, e := range v.escapes {
					if e.what != "return" && e.line <= lastWrite {
						before = append(before, fmt.Sprintf("%d %s", e.line, e.what))
					}
				}
				class := "local-buffer"
				switch {
				case v.kind == "field" || v.kind == "call":
					class = "stored-slice"
				case v.kind == "param":
					class = "param"
				case v.kind == "global":
					class = "global"
				case len(before) > 0:
					class = "escape-then-write"
				}
				fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", rel(fd.Pos()), funcName(fd), class, v.kind, v.name, v.typ, strings.Join(ws, "; "), strings.Join(before, "; "))
			}
		}
	}
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	mode := os.Args[1]
	for _, t := range os.Args[2:] {
		p := im.load(modPrefix + "internal/" + t)
		if p == nil {
			continue
		}
		rel := func(pos token.Pos) string {
			ps := fset.Position(pos)
			return strings.TrimPrefix(ps.Filename, root+"internal/") + ":" + fmt.Sprint(ps.Line)
		}
		line := func(pos token.Pos) int { return fset.Position(pos).Line }
		switch mode {
		case "slicewrites":
			slicewrites(fset, p, rel, line)
		case "same":
			for _, f := range p.files {
				var cur *ast.FuncDecl
				ast.Inspect(f, func(n ast.Node) bool {
					switch x := n.(type) {
					case *ast.FuncDecl:
						cur = x
					case *ast.CallExpr:
						if exprString(fset, x.Fun) == "core.Same" && len(x.Args) == 2 {
							fmt.Printf("%s\t%s\t%s\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x.Args[0]), exprString(fset, x.Args[1]), shortType(p.info.TypeOf(x.Args[0])))
						}
					}
					return true
				})
			}
		case "funcvalues":
			for _, f := range p.files {
				var cur *ast.FuncDecl
				isFunc := func(e ast.Expr) bool {
					t := p.info.TypeOf(e)
					if t == nil {
						return false
					}
					_, ok := t.Underlying().(*types.Signature)
					return ok
				}
				describe := func(e ast.Expr) string {
					switch x := e.(type) {
					case *ast.FuncLit:
						return "closure"
					case *ast.SelectorExpr:
						if sel := p.info.Selections[x]; sel != nil && sel.Kind() == types.MethodVal {
							return "method value " + exprString(fset, x)
						}
						return "field value " + exprString(fset, x)
					case *ast.Ident:
						if _, ok := p.info.Uses[x].(*types.Func); ok {
							return "function " + x.Name
						}
						if x.Name == "nil" {
							return ""
						}
						return "variable " + x.Name
					case *ast.CallExpr:
						return "result of " + exprString(fset, x.Fun)
					}
					return exprString(fset, e)
				}
				ast.Inspect(f, func(n ast.Node) bool {
					switch x := n.(type) {
					case *ast.FuncDecl:
						cur = x
					case *ast.AssignStmt:
						for i, r := range x.Rhs {
							if i >= len(x.Lhs) || !isFunc(r) {
								continue
							}
							switch l := x.Lhs[i].(type) {
							case *ast.SelectorExpr, *ast.IndexExpr:
								if d := describe(r); d != "" {
									fmt.Printf("%s\t%s\tstored in %s\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, l), d, shortType(p.info.TypeOf(r)))
								}
							}
						}
					case *ast.CompositeLit:
						for _, el := range x.Elts {
							v := el
							key := ""
							if kv, ok := el.(*ast.KeyValueExpr); ok {
								v = kv.Value
								key = exprString(fset, kv.Key)
							}
							if isFunc(v) {
								if d := describe(v); d != "" {
									fmt.Printf("%s\t%s\tliteral %s.%s\t%s\t%s\n", rel(x.Pos()), funcName(cur), shortType(p.info.TypeOf(x)), key, d, shortType(p.info.TypeOf(v)))
								}
							}
						}
					case *ast.ReturnStmt:
						for _, r := range x.Results {
							if isFunc(r) {
								if d := describe(r); d != "" {
									fmt.Printf("%s\t%s\treturned\t%s\t%s\n", rel(x.Pos()), funcName(cur), d, shortType(p.info.TypeOf(r)))
								}
							}
						}
					}
					return true
				})
			}
		case "loops":
			for _, f := range p.files {
				var cur *ast.FuncDecl
				ast.Inspect(f, func(n ast.Node) bool {
					switch x := n.(type) {
					case *ast.FuncDecl:
						cur = x
					case *ast.ForStmt:
						if x.Cond == nil {
							fmt.Printf("%s\t%s\tfor without condition\t\n", rel(x.Pos()), funcName(cur))
						} else if x.Init == nil && x.Post == nil {
							fmt.Printf("%s\t%s\tfor with condition only\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x.Cond))
						}
					}
					return true
				})
			}
		case "structs":
			scope := p.pkg.Scope()
			names := scope.Names()
			for _, name := range names {
				tn, ok := scope.Lookup(name).(*types.TypeName)
				if !ok {
					continue
				}
				st, ok := tn.Type().Underlying().(*types.Struct)
				if !ok {
					continue
				}
				for i := 0; i < st.NumFields(); i++ {
					fl := st.Field(i)
					emb := ""
					if fl.Embedded() {
						emb = "embedded"
					}
					fmt.Printf("%s\t%s\t%d\t%s\t%s\t%s\n", rel(tn.Pos()), name, i, fl.Name(), shortType(fl.Type()), emb)
				}
			}
		}
	}
}
