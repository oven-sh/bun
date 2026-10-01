// astfacts: type-checks internal/ast of the reference with go/types and prints, as JSON,
// (1) every struct that implements nodeData: flattened fields with the embedding path, and for each nodeData
//     method the struct that declares the method that *T selects,
// (2) every method on *Node and *MutableNode of ast.go: signature, source range, and when the body is a switch on
//     the kind, its cases.
// usage: go run . > ../data/astfacts.json
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

func src(fset *token.FileSet, n ast.Node) string {
	var sb strings.Builder
	printer.Fprint(&sb, fset, n)
	return sb.String()
}

type Field struct {
	Name  string   `json:"name"`
	Type  string   `json:"type"`
	Owner string   `json:"owner"`
	Path  []string `json:"path"`
}

type Struct struct {
	Name    string            `json:"name"`
	File    string            `json:"file"`
	Line    int               `json:"line"`
	Fields  []Field           `json:"fields"`
	Methods map[string]string `json:"methods"`
	Embeds  []string          `json:"embeds"`
}

type Case struct {
	Kinds []string `json:"kinds"`
	Body  string   `json:"body"`
	Cast  string   `json:"cast,omitempty"`
	Field string   `json:"field,omitempty"`
}

type Method struct {
	Recv    string   `json:"recv"`
	Name    string   `json:"name"`
	Params  []string `json:"params"`
	Results []string `json:"results"`
	File    string   `json:"file"`
	Line    int      `json:"line"`
	EndLine int      `json:"endLine"`
	Shape   string   `json:"shape"`
	Cases   []Case   `json:"cases,omitempty"`
	Default string   `json:"default,omitempty"`
	Tail    string   `json:"tail,omitempty"`
	Source  string   `json:"source"`
}

type Out struct {
	Structs     []Struct `json:"structs"`
	Methods     []Method `json:"methods"`
	NodeData    []string `json:"nodeData"`
	TypeErrors  int      `json:"typeErrors"`
	Commit      string   `json:"commit"`
	BaseStructs []Struct `json:"baseStructs"`
}

func qual(p *types.Package) string { return p.Name() }

func flatten(t *types.Struct, owner string, path []string, out *[]Field) {
	for i := 0; i < t.NumFields(); i++ {
		f := t.Field(i)
		if f.Embedded() {
			name := f.Name()
			if st, ok := f.Type().Underlying().(*types.Struct); ok {
				flatten(st, name, append(append([]string{}, path...), name), out)
				continue
			}
		}
		*out = append(*out, Field{Name: f.Name(), Type: types.TypeString(f.Type(), qual), Owner: owner, Path: append([]string{}, path...)})
	}
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	p := im.load(modPrefix + "internal/ast")
	if p == nil || p.pkg == nil {
		fmt.Fprintln(os.Stderr, "cannot load internal/ast")
		os.Exit(1)
	}
	scope := p.pkg.Scope()
	nodeDataObj := scope.Lookup("nodeData")
	iface := nodeDataObj.Type().Underlying().(*types.Interface)
	out := Out{Commit: "89d5d5b"}
	var ifaceMethods []string
	for i := 0; i < iface.NumMethods(); i++ {
		ifaceMethods = append(ifaceMethods, iface.Method(i).Name())
	}
	sort.Strings(ifaceMethods)
	out.NodeData = ifaceMethods

	names := scope.Names()
	for _, name := range names {
		obj, ok := scope.Lookup(name).(*types.TypeName)
		if !ok || obj.IsAlias() {
			continue
		}
		named, ok := obj.Type().(*types.Named)
		if !ok {
			continue
		}
		st, ok := named.Underlying().(*types.Struct)
		if !ok {
			continue
		}
		ptr := types.NewPointer(named)
		implements := types.Implements(ptr, iface)
		isBase := strings.HasSuffix(name, "Base") || name == "NodeDefault"
		if !implements && !isBase {
			continue
		}
		pos := fset.Position(obj.Pos())
		s := Struct{Name: name, File: filepath.Base(pos.Filename), Line: pos.Line, Methods: map[string]string{}}
		flatten(st, name, nil, &s.Fields)
		for i := 0; i < st.NumFields(); i++ {
			if st.Field(i).Embedded() {
				s.Embeds = append(s.Embeds, st.Field(i).Name())
			}
		}
		ms := types.NewMethodSet(ptr)
		for _, m := range ifaceMethods {
			sel := ms.Lookup(p.pkg, m)
			if sel == nil {
				continue
			}
			fn := sel.Obj().(*types.Func)
			recv := fn.Type().(*types.Signature).Recv().Type()
			if pt, ok := recv.(*types.Pointer); ok {
				recv = pt.Elem()
			}
			s.Methods[m] = types.TypeString(recv, qual)
		}
		if implements && !isBase {
			out.Structs = append(out.Structs, s)
		} else {
			out.BaseStructs = append(out.BaseStructs, s)
		}
	}

	for _, f := range p.files {
		fname := filepath.Base(fset.Position(f.Pos()).Filename)
		if fname != "ast.go" && fname != "utilities.go" {
			continue
		}
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Recv == nil || len(fd.Recv.List) == 0 {
				continue
			}
			recv := src(fset, fd.Recv.List[0].Type)
			if recv != "*Node" && recv != "*MutableNode" {
				continue
			}
			recvName := "n"
			if len(fd.Recv.List[0].Names) > 0 {
				recvName = fd.Recv.List[0].Names[0].Name
			}
			m := Method{Recv: strings.TrimPrefix(recv, "*"), Name: fd.Name.Name, File: fname, Line: fset.Position(fd.Pos()).Line, EndLine: fset.Position(fd.End()).Line, Source: src(fset, fd)}
			if fd.Type.Params != nil {
				for _, prm := range fd.Type.Params.List {
					t := src(fset, prm.Type)
					if len(prm.Names) == 0 {
						m.Params = append(m.Params, "_ "+t)
					}
					for _, n := range prm.Names {
						m.Params = append(m.Params, n.Name+" "+t)
					}
				}
			}
			if fd.Type.Results != nil {
				for _, r := range fd.Type.Results.List {
					m.Results = append(m.Results, src(fset, r.Type))
				}
			}
			m.Shape = "other"
			if fd.Body != nil {
				classify(fset, fd, recvName, &m)
			}
			out.Methods = append(out.Methods, m)
		}
	}
	sort.Slice(out.Methods, func(i, j int) bool {
		if out.Methods[i].File != out.Methods[j].File {
			return out.Methods[i].File < out.Methods[j].File
		}
		return out.Methods[i].Line < out.Methods[j].Line
	})
	for _, n := range im.errs {
		out.TypeErrors += n
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var keys []string
	for k, v := range im.errs {
		keys = append(keys, fmt.Sprintf("%s=%d", strings.TrimPrefix(k, modPrefix), v))
	}
	sort.Strings(keys)
	fmt.Fprintln(os.Stderr, "type errors per package:", strings.Join(keys, " "))
}

// A body is a "switch" when, after optional `n := (*Node)(m)`, its first statement is `switch <recv>.Kind`.
func classify(fset *token.FileSet, fd *ast.FuncDecl, recvName string, m *Method) {
	stmts := fd.Body.List
	if len(stmts) > 0 {
		if as, ok := stmts[0].(*ast.AssignStmt); ok && as.Tok == token.DEFINE && len(as.Lhs) == 1 {
			if strings.Contains(src(fset, as.Rhs[0]), "(*Node)(") {
				stmts = stmts[1:]
			}
		}
	}
	if len(stmts) == 0 {
		return
	}
	sw, ok := stmts[0].(*ast.SwitchStmt)
	if !ok || sw.Tag == nil {
		return
	}
	tag := src(fset, sw.Tag)
	if !strings.HasSuffix(tag, ".Kind") {
		return
	}
	m.Shape = "switch"
	for _, c := range sw.Body.List {
		cc := c.(*ast.CaseClause)
		var body []string
		for _, s := range cc.Body {
			body = append(body, src(fset, s))
		}
		bodySrc := strings.Join(body, "\n")
		if cc.List == nil {
			m.Default = bodySrc
			continue
		}
		cs := Case{Body: bodySrc}
		for _, e := range cc.List {
			cs.Kinds = append(cs.Kinds, strings.TrimPrefix(src(fset, e), "Kind"))
		}
		// `return n.AsX().F` or `n.AsX().F = v`
		if len(cc.Body) == 1 {
			var target ast.Expr
			switch s := cc.Body[0].(type) {
			case *ast.ReturnStmt:
				if len(s.Results) == 1 {
					target = s.Results[0]
				}
			case *ast.AssignStmt:
				if len(s.Lhs) == 1 && s.Tok == token.ASSIGN {
					target = s.Lhs[0]
				}
			}
			if sel, ok := target.(*ast.SelectorExpr); ok {
				if call, ok := sel.X.(*ast.CallExpr); ok && len(call.Args) == 0 {
					if fun, ok := call.Fun.(*ast.SelectorExpr); ok && strings.HasPrefix(fun.Sel.Name, "As") {
						cs.Cast = strings.TrimPrefix(fun.Sel.Name, "As")
						cs.Field = sel.Sel.Name
					}
				}
			}
		}
		m.Cases = append(m.Cases, cs)
	}
	var tail []string
	for _, s := range stmts[1:] {
		tail = append(tail, src(fset, s))
	}
	m.Tail = strings.Join(tail, "\n")
}
