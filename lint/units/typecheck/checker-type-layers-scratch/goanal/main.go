package main

import (
	"bufio"
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
			if im.errs[path] <= 5 {
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

func recvName(fd *ast.FuncDecl) string {
	if fd.Recv != nil && len(fd.Recv.List) > 0 {
		var sb strings.Builder
		printer.Fprint(&sb, token.NewFileSet(), fd.Recv.List[0].Type)
		return sb.String()
	}
	return ""
}

func funcName(fd *ast.FuncDecl) string {
	if fd == nil {
		return "<toplevel>"
	}
	r := recvName(fd)
	if r != "" {
		return "(" + r + ")." + fd.Name.Name
	}
	return fd.Name.Name
}

func objFuncName(o types.Object) string {
	f, ok := o.(*types.Func)
	if !ok {
		return ""
	}
	sig := f.Type().(*types.Signature)
	if sig.Recv() != nil {
		t := sig.Recv().Type()
		s := types.TypeString(t, func(p *types.Package) string { return "" })
		return "(" + s + ")." + f.Name()
	}
	return f.Name()
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	outDir := os.Args[1]
	target := os.Args[2]
	p := im.load(modPrefix + "internal/" + target)
	if p == nil {
		os.Exit(1)
	}
	open := func(name string) (*bufio.Writer, func()) {
		f, err := os.Create(filepath.Join(outDir, name))
		if err != nil {
			panic(err)
		}
		w := bufio.NewWriter(f)
		return w, func() { w.Flush(); f.Close() }
	}
	funcs, c1 := open("funcs.tsv")
	defer c1()
	edges, c2 := open("edges.tsv")
	defer c2()
	panics, c3 := open("panics.tsv")
	defer c3()
	muts, c4 := open("mutations.tsv")
	defer c4()
	diags, c5 := open("diags.tsv")
	defer c5()
	lits, c6 := open("intlits.tsv")
	defer c6()
	ext, c7 := open("extcalls.tsv")
	defer c7()
	rel := func(pos token.Pos) string {
		ps := fset.Position(pos)
		return strings.TrimPrefix(ps.Filename, root+"internal/") + ":" + fmt.Sprint(ps.Line)
	}
	line := func(pos token.Pos) int { return fset.Position(pos).Line }
	qual := func(p *types.Package) string { return p.Name() }
	for _, f := range p.files {
		fname := strings.TrimPrefix(fset.Position(f.Pos()).Filename, root+"internal/")
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			name := funcName(fd)
			start := line(fd.Pos())
			if fd.Doc != nil {
				start = line(fd.Doc.Pos())
			}
			fmt.Fprintf(funcs, "%s\t%d\t%d\t%d\t%s\n", fname, start, line(fd.Pos()), line(fd.End()), name)
			if fd.Body == nil {
				continue
			}
			seen := map[string]bool{}
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.Ident:
					if o := p.info.Uses[x]; o != nil {
						if fo, ok := o.(*types.Func); ok && fo.Pkg() != nil {
							cn := objFuncName(o)
							if fo.Pkg() == p.pkg {
								k := cn
								if !seen[k] {
									seen[k] = true
									fmt.Fprintf(edges, "%s\t%s\t%s\t%d\n", fname, name, cn, line(x.Pos()))
								}
							} else {
								k := fo.Pkg().Name() + "." + cn
								if !seen[k] {
									seen[k] = true
									fmt.Fprintf(ext, "%s\t%s\t%s\t%d\n", fname, name, k, line(x.Pos()))
								}
							}
						}
						if v, ok := o.(*types.Var); ok && v.Pkg() != nil && v.Pkg().Name() == "diagnostics" {
							fmt.Fprintf(diags, "%s\t%s\t%s\n", rel(x.Pos()), name, v.Name())
						}
					}
				case *ast.CallExpr:
					if id, ok := x.Fun.(*ast.Ident); ok && id.Name == "panic" {
						fmt.Fprintf(panics, "%s\t%s\tpanic\t%s\n", rel(x.Pos()), name, exprString(fset, x))
					}
					if se, ok := x.Fun.(*ast.SelectorExpr); ok {
						if id, ok := se.X.(*ast.Ident); ok && id.Name == "debug" {
							fmt.Fprintf(panics, "%s\t%s\tdebug.%s\t%s\n", rel(x.Pos()), name, se.Sel.Name, exprString(fset, x))
						}
					}
				case *ast.AssignStmt:
					for _, l := range x.Lhs {
						base := l
						// unwrap index expressions
						for {
							if ie, ok := base.(*ast.IndexExpr); ok {
								base = ie.X
								continue
							}
							break
						}
						if se, ok := base.(*ast.SelectorExpr); ok {
							tv := p.info.TypeOf(se.X)
							ts := "?"
							if tv != nil {
								ts = types.TypeString(tv, qual)
							}
							fmt.Fprintf(muts, "%s\t%s\t%s\t%s\t%s\n", rel(x.Pos()), name, ts, se.Sel.Name, exprString(fset, x))
						}
					}
				case *ast.IncDecStmt:
					if se, ok := x.X.(*ast.SelectorExpr); ok {
						tv := p.info.TypeOf(se.X)
						ts := "?"
						if tv != nil {
							ts = types.TypeString(tv, qual)
						}
						fmt.Fprintf(muts, "%s\t%s\t%s\t%s\t%s\n", rel(x.Pos()), name, ts, se.Sel.Name, exprString(fset, x))
					}
				case *ast.BinaryExpr:
					switch x.Op {
					case token.LSS, token.LEQ, token.GTR, token.GEQ, token.EQL, token.NEQ:
						for _, side := range []ast.Expr{x.X, x.Y} {
							if bl, ok := side.(*ast.BasicLit); ok && bl.Kind == token.INT {
								if len(bl.Value) >= 2 && bl.Value != "10" {
									fmt.Fprintf(lits, "%s\t%s\t%s\n", rel(x.Pos()), name, exprString(fset, x))
								}
							}
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
