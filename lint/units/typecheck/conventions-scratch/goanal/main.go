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
	if len(s) > 160 {
		s = s[:160] + "..."
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

func isMap(t types.Type) (*types.Map, bool) {
	if t == nil {
		return nil, false
	}
	m, ok := t.Underlying().(*types.Map)
	return m, ok
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	targets := os.Args[2:]
	mode := os.Args[1]
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
			var cur *ast.FuncDecl
			ast.Inspect(f, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.FuncDecl:
					cur = x
				case *ast.RangeStmt:
					if mode == "maprange" {
						tv := p.info.TypeOf(x.X)
						if m, ok := isMap(tv); ok {
							k, v := "_", "_"
							if x.Key != nil {
								k = exprString(fset, x.Key)
							}
							if x.Value != nil {
								v = exprString(fset, x.Value)
							}
							fmt.Printf("%s\t%s\trange\t%s\t%s\tk=%s v=%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x.X), types.TypeString(m, func(p *types.Package) string { return p.Name() }), k, v)
						} else if tv == nil || tv == types.Typ[types.Invalid] {
							fmt.Printf("%s\t%s\trange-UNKNOWN\t%s\t?\t\n", rel(x.Pos()), funcName(cur), exprString(fset, x.X))
						} else if _, ok := tv.Underlying().(*types.Signature); ok {
							fmt.Printf("%s\t%s\trange-func\t%s\t%s\t\n", rel(x.Pos()), funcName(cur), exprString(fset, x.X), types.TypeString(tv, func(p *types.Package) string { return p.Name() }))
						}
					}
				case *ast.CallExpr:
					if mode == "maprange" {
						if se, ok := x.Fun.(*ast.SelectorExpr); ok {
							if id, ok := se.X.(*ast.Ident); ok && (id.Name == "maps") {
								fmt.Printf("%s\t%s\tmaps.%s\t%s\t\t\n", rel(x.Pos()), funcName(cur), se.Sel.Name, exprString(fset, x))
							}
						}
					}
					if mode == "sort" {
						if se, ok := x.Fun.(*ast.SelectorExpr); ok {
							if id, ok := se.X.(*ast.Ident); ok && (id.Name == "slices" || id.Name == "sort") {
								n := se.Sel.Name
								if strings.Contains(n, "Sort") || n == "Slice" || n == "SliceStable" || n == "Strings" || n == "Ints" || strings.HasPrefix(n, "BinarySearch") || n == "Compact" || n == "CompactFunc" {
									fmt.Printf("%s\t%s\t%s.%s\t%s\n", rel(x.Pos()), funcName(cur), id.Name, n, exprString(fset, x))
								}
							}
						}
					}
				case *ast.BinaryExpr:
					if mode == "nilcmp" && (x.Op == token.EQL || x.Op == token.NEQ) {
						var other ast.Expr
						if id, ok := x.Y.(*ast.Ident); ok && id.Name == "nil" {
							other = x.X
						} else if id, ok := x.X.(*ast.Ident); ok && id.Name == "nil" {
							other = x.Y
						}
						if other != nil {
							tv := p.info.TypeOf(other)
							if tv != nil {
								switch tv.Underlying().(type) {
								case *types.Slice:
									fmt.Printf("%s\t%s\tslice-nil\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x), types.TypeString(tv, func(p *types.Package) string { return p.Name() }))
								case *types.Map:
									fmt.Printf("%s\t%s\tmap-nil\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x), types.TypeString(tv, func(p *types.Package) string { return p.Name() }))
								case *types.Signature:
									fmt.Printf("%s\t%s\tfunc-nil\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x), types.TypeString(tv, func(p *types.Package) string { return p.Name() }))
								case *types.Interface:
									fmt.Printf("%s\t%s\tiface-nil\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x), types.TypeString(tv, func(p *types.Package) string { return p.Name() }))
								}
							}
						}
					}
				case *ast.FuncLit:
					if mode == "closures" {
						fmt.Printf("%s\t%s\tfunclit\n", rel(x.Pos()), funcName(cur))
					}
				case *ast.DeferStmt:
					if mode == "defer" {
						fmt.Printf("%s\t%s\tdefer\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x.Call))
					}
				case *ast.MapType:
					if mode == "maptypes" {
						tv := p.info.TypeOf(x)
						if tv != nil {
							fmt.Printf("%s\t%s\tmaptype\t%s\n", rel(x.Pos()), funcName(cur), types.TypeString(tv, func(p *types.Package) string { return p.Name() }))
						}
					}
				}
				return true
			})
		}
	}
	var keys []string
	for k, v := range im.errs {
		keys = append(keys, fmt.Sprintf("%s=%d", strings.TrimPrefix(k, modPrefix), v))
	}
	sort.Strings(keys)
	fmt.Fprintln(os.Stderr, "type errors per package:", strings.Join(keys, " "))
}
