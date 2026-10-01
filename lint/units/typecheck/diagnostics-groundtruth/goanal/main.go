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
		Error:       func(err error) { im.errs[path]++ },
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

func qual(p *types.Package) string { return p.Name() }

func tstr(t types.Type) string {
	if t == nil {
		return "<nil>"
	}
	return types.TypeString(t, qual)
}

func isMsgPtr(t types.Type) bool {
	return t != nil && tstr(t) == "*diagnostics.Message"
}

func isDiagPtr(t types.Type) bool {
	return t != nil && tstr(t) == "*ast.Diagnostic"
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	mode := os.Args[1]
	targets := os.Args[2:]
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
				case *ast.CallExpr:
					if mode == "diagargs" {
						ft := p.info.TypeOf(x.Fun)
						if ft == nil {
							return true
						}
						sig, ok := ft.Underlying().(*types.Signature)
						if !ok || !sig.Variadic() {
							return true
						}
						params := sig.Params()
						np := params.Len()
						last := params.At(np - 1).Type()
						sl, ok := last.(*types.Slice)
						if !ok {
							return true
						}
						if _, ok := sl.Elem().Underlying().(*types.Interface); !ok {
							return true
						}
						msgIdx := -1
						for i := 0; i < np-1; i++ {
							if isMsgPtr(params.At(i).Type()) {
								msgIdx = i
							}
						}
						if msgIdx < 0 {
							return true
						}
						msgExpr := "?"
						if msgIdx < len(x.Args) {
							msgExpr = exprString(fset, x.Args[msgIdx])
						}
						var ts []string
						if x.Ellipsis.IsValid() {
							ts = append(ts, "SPREAD:"+tstr(p.info.TypeOf(x.Args[len(x.Args)-1])))
						} else {
							for i := np - 1; i < len(x.Args); i++ {
								at := p.info.TypeOf(x.Args[i])
								s := tstr(at)
								if tv, ok := p.info.Types[x.Args[i]]; ok && tv.Value != nil {
									s += "(const)"
								}
								ts = append(ts, s+"«"+exprString(fset, x.Args[i])+"»")
							}
						}
						fmt.Printf("%s\t%s\t%s\t%s\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x.Fun), msgExpr, strings.Join(ts, " | "))
					}
					if mode == "diagmethods" {
						if se, ok := x.Fun.(*ast.SelectorExpr); ok {
							rt := p.info.TypeOf(se.X)
							if isDiagPtr(rt) {
								fmt.Printf("%s\t%s\tDiagnostic.%s\n", rel(x.Pos()), funcName(cur), se.Sel.Name)
							} else if isMsgPtr(rt) {
								fmt.Printf("%s\t%s\tMessage.%s\n", rel(x.Pos()), funcName(cur), se.Sel.Name)
							} else if rt != nil && strings.Contains(tstr(rt), "DiagnosticsCollection") {
								fmt.Printf("%s\t%s\tDiagnosticsCollection.%s\n", rel(x.Pos()), funcName(cur), se.Sel.Name)
							} else if id, ok := se.X.(*ast.Ident); ok && (id.Name == "ast" || id.Name == "diagnostics" || id.Name == "diagnosticwriter") {
								nm := se.Sel.Name
								if strings.Contains(nm, "Diagnostic") || nm == "Format" || nm == "Localize" || nm == "StringifyArgs" || nm == "NewAdHocMessage" {
									fmt.Printf("%s\t%s\t%s.%s\n", rel(x.Pos()), funcName(cur), id.Name, nm)
								}
							}
						}
					}
				case *ast.BinaryExpr:
					if mode == "msgcmp" && (x.Op == token.EQL || x.Op == token.NEQ) {
						lt, rt := p.info.TypeOf(x.X), p.info.TypeOf(x.Y)
						if isMsgPtr(lt) || isMsgPtr(rt) {
							kind := "ptr"
							if id, ok := x.Y.(*ast.Ident); ok && id.Name == "nil" {
								kind = "nil"
							}
							if id, ok := x.X.(*ast.Ident); ok && id.Name == "nil" {
								kind = "nil"
							}
							fmt.Printf("%s\t%s\tcmp-%s\t%s\n", rel(x.Pos()), funcName(cur), kind, exprString(fset, x))
						}
						if isDiagPtr(lt) || isDiagPtr(rt) {
							kind := "ptr"
							if id, ok := x.Y.(*ast.Ident); ok && id.Name == "nil" {
								kind = "nil"
							}
							if id, ok := x.X.(*ast.Ident); ok && id.Name == "nil" {
								kind = "nil"
							}
							fmt.Printf("%s\t%s\tdiagcmp-%s\t%s\n", rel(x.Pos()), funcName(cur), kind, exprString(fset, x))
						}
					}
				case *ast.SwitchStmt:
					if mode == "msgcmp" && x.Tag != nil {
						if isMsgPtr(p.info.TypeOf(x.Tag)) {
							ncase := 0
							var names []string
							for _, c := range x.Body.List {
								cc := c.(*ast.CaseClause)
								for _, e := range cc.List {
									ncase++
									names = append(names, exprString(fset, e))
								}
							}
							fmt.Printf("%s\t%s\tswitch\t%s\tcases=%d\t%s\n", rel(x.Pos()), funcName(cur), exprString(fset, x.Tag), ncase, strings.Join(names, ","))
						}
					}
				case *ast.SelectorExpr:
					if mode == "msguse" {
						if id, ok := x.X.(*ast.Ident); ok && id.Name == "diagnostics" {
							if isMsgPtr(p.info.TypeOf(x)) {
								fmt.Printf("%s\t%s\n", t, x.Sel.Name)
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
