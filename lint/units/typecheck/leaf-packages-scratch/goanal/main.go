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
const root = "/workspace/ref/typescript-go/"

type pkgInfo struct {
	pkg   *types.Package
	info  *types.Info
	files []*ast.File
	// decl nodes by object
	decl map[types.Object]ast.Node
	// owner struct name of a field object
	fieldOwner map[types.Object]string
	// enclosing top-level decl objects -> body node(s) to walk
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
		GoVersion:   "go1.24",
	}
	pkg, _ := conf.Check(path, im.fset, files, info)
	p := &pkgInfo{pkg: pkg, info: info, files: files, decl: map[types.Object]ast.Node{}, fieldOwner: map[types.Object]string{}}
	for _, f := range files {
		for _, d := range f.Decls {
			switch x := d.(type) {
			case *ast.FuncDecl:
				if o := info.Defs[x.Name]; o != nil {
					p.decl[o] = x
				}
			case *ast.GenDecl:
				for _, s := range x.Specs {
					switch sp := s.(type) {
					case *ast.TypeSpec:
						if o := info.Defs[sp.Name]; o != nil {
							p.decl[o] = sp
						}
						if st, ok := sp.Type.(*ast.StructType); ok {
							for _, fl := range st.Fields.List {
								for _, n := range fl.Names {
									if o := info.Defs[n]; o != nil {
										p.fieldOwner[o] = sp.Name.Name
										p.decl[o] = fl
									}
								}
								if len(fl.Names) == 0 {
									// embedded
									var id *ast.Ident
									t := fl.Type
									if se, ok := t.(*ast.StarExpr); ok {
										t = se.X
									}
									switch tt := t.(type) {
									case *ast.Ident:
										id = tt
									case *ast.SelectorExpr:
										id = tt.Sel
									}
									_ = id
								}
							}
						}
						if it, ok := sp.Type.(*ast.InterfaceType); ok {
							for _, fl := range it.Methods.List {
								for _, n := range fl.Names {
									if o := info.Defs[n]; o != nil {
										p.fieldOwner[o] = sp.Name.Name
										p.decl[o] = fl
									}
								}
							}
						}
					case *ast.ValueSpec:
						for _, n := range sp.Names {
							if o := info.Defs[n]; o != nil {
								p.decl[o] = sp
							}
						}
					}
				}
			}
		}
	}
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

type entry struct {
	Pkg      string   `json:"pkg"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	File     string   `json:"file"`
	Line     int      `json:"line"`
	End      int      `json:"end"`
	Direct   int      `json:"direct"`
	DirectBy []string `json:"directBy,omitempty"`
	Depth    int      `json:"depth"`
	Via      string   `json:"via,omitempty"`
	Std      []string `json:"std,omitempty"`
	Panics   int      `json:"panics,omitempty"`
}

func recvName(f *types.Func) string {
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
	// interface method: receiver is the interface type itself
	return ""
}

func main() {
	fset := token.NewFileSet()
	im := &imp{fset: fset, std: importer.ForCompiler(fset, "source", nil), cache: map[string]*pkgInfo{}, errs: map[string]int{}}
	rootsArg := strings.Split(os.Args[1], ",")
	targetsArg := strings.Split(os.Args[2], ",")
	outPath := os.Args[3]
	targets := map[string]bool{}
	for _, t := range targetsArg {
		targets[modPrefix+"internal/"+t] = true
	}
	rootSet := map[string]bool{}
	for _, r := range rootsArg {
		rootSet[modPrefix+"internal/"+r] = true
	}
	entries := map[types.Object]*entry{}
	var queue []types.Object
	edges := map[string]map[string]bool{}

	rel := func(pos token.Pos) (string, int) {
		ps := fset.Position(pos)
		return strings.TrimPrefix(ps.Filename, root+"internal/"), ps.Line
	}

	objKey := func(o types.Object) (string, string) {
		switch x := o.(type) {
		case *types.Func:
			r := recvName(x)
			if r != "" {
				return "method", r + "." + x.Name()
			}
			// interface method?
			if sig, ok := x.Type().(*types.Signature); ok && sig.Recv() != nil {
				return "imethod", "?" + "." + x.Name()
			}
			return "func", x.Name()
		case *types.TypeName:
			return "type", x.Name()
		case *types.Const:
			return "const", x.Name()
		case *types.Var:
			if x.IsField() {
				return "field", x.Name()
			}
			return "var", x.Name()
		}
		return "other", o.Name()
	}

	record := func(o types.Object, depth int, via string, byPkg string) {
		if o == nil || o.Pkg() == nil {
			return
		}
		if f, ok := o.(*types.Func); ok {
			o = f.Origin()
		}
		if v, ok := o.(*types.Var); ok {
			o = v.Origin()
		}
		pp := o.Pkg().Path()
		if !targets[pp] {
			return
		}
		// skip local (non package-level, non-field, non-method) objects
		pi := im.cache[pp]
		if pi == nil {
			return
		}
		kind, name := objKey(o)
		if kind == "var" || kind == "const" || kind == "type" || kind == "func" {
			if o.Parent() != o.Pkg().Scope() {
				return
			}
		}
		e := entries[o]
		if e == nil {
			file, line := rel(o.Pos())
			end := line
			if d, ok := pi.decl[o]; ok {
				_, end = rel(d.End())
				if fd, ok := d.(*ast.FuncDecl); ok {
					_, line = rel(fd.Pos())
				}
			}
			if kind == "field" || kind == "imethod" {
				if own, ok := pi.fieldOwner[o]; ok {
					name = own + "." + o.Name()
				}
			}
			e = &entry{Pkg: strings.TrimPrefix(pp, modPrefix+"internal/"), Name: name, Kind: kind, File: file, Line: line, End: end, Depth: depth, Via: via}
			entries[o] = e
			queue = append(queue, o)
		}
		if depth == 0 {
			e.Direct++
			found := false
			for _, b := range e.DirectBy {
				if b == byPkg {
					found = true
				}
			}
			if !found {
				e.DirectBy = append(e.DirectBy, byPkg)
			}
			if e.Depth != 0 {
				e.Depth = 0
				e.Via = ""
			}
		}
	}

	walk := func(pi *pkgInfo, n ast.Node, depth int, via string, byPkg string, self *entry) {
		ast.Inspect(n, func(x ast.Node) bool {
			switch id := x.(type) {
			case *ast.Ident:
				if o := pi.info.Uses[id]; o != nil {
					if o.Pkg() != nil && !strings.HasPrefix(o.Pkg().Path(), modPrefix) && self != nil {
						// std usage
						k := o.Pkg().Name() + "." + o.Name()
						if f, ok := o.(*types.Func); ok {
							if r := recvName(f); r != "" {
								k = o.Pkg().Name() + "." + r + "." + o.Name()
							}
						}
						if _, isVar := o.(*types.Var); !isVar || o.Parent() == o.Pkg().Scope() {
							found := false
							for _, s := range self.Std {
								if s == k {
									found = true
								}
							}
							if !found {
								self.Std = append(self.Std, k)
							}
						}
					}
					if o.Pkg() == nil && o.Name() == "panic" && self != nil {
						self.Panics++
					}
					record(o, depth, via, byPkg)
					if self != nil {
						if f, ok := o.(*types.Func); ok && f.Pkg() != nil && targets[f.Pkg().Path()] {
							f = f.Origin()
							_, nm := objKey(f)
							callee := strings.TrimPrefix(f.Pkg().Path(), modPrefix+"internal/") + "." + nm
							caller := self.Pkg + "." + self.Name
							if edges[caller] == nil {
								edges[caller] = map[string]bool{}
							}
							edges[caller][callee] = true
						}
					}
				}
			}
			return true
		})
	}

	for r := range rootSet {
		pi := im.load(r)
		if pi == nil {
			continue
		}
		short := strings.TrimPrefix(r, modPrefix+"internal/")
		excl := map[string]bool{}
		for _, x := range strings.Split(os.Getenv("EXCLUDE_FILES"), ",") {
			if x != "" {
				excl[x] = true
			}
		}
		for _, f := range pi.files {
			fn := fset.Position(f.Pos()).Filename
			if excl[short+"/"+filepath.Base(fn)] {
				continue
			}
			walk(pi, f, 0, "", short, nil)
		}
	}
	// transitive closure
	for len(queue) > 0 {
		o := queue[0]
		queue = queue[1:]
		e := entries[o]
		pp := o.Pkg().Path()
		if rootSet[pp] {
			continue // whole package is already walked
		}
		pi := im.cache[pp]
		d, ok := pi.decl[o]
		if !ok {
			continue
		}
		switch x := d.(type) {
		case *ast.FuncDecl:
			walk(pi, x, e.Depth+1, e.Pkg+"."+e.Name, "", e)
		case *ast.ValueSpec:
			walk(pi, x, e.Depth+1, e.Pkg+"."+e.Name, "", e)
		case *ast.TypeSpec:
			// walk the type's definition for referenced types only
			walk(pi, x, e.Depth+1, e.Pkg+"."+e.Name, "", e)
		case *ast.Field:
			walk(pi, x.Type, e.Depth+1, e.Pkg+"."+e.Name, "", e)
		}
	}
	var list []*entry
	for _, e := range entries {
		sort.Strings(e.Std)
		sort.Strings(e.DirectBy)
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
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Name < b.Name
	})
	out, _ := json.MarshalIndent(list, "", " ")
	os.WriteFile(outPath, out, 0o644)
	el := map[string][]string{}
	for k, v := range edges {
		for c := range v {
			el[k] = append(el[k], c)
		}
		sort.Strings(el[k])
	}
	eo, _ := json.MarshalIndent(el, "", " ")
	os.WriteFile(outPath+".edges.json", eo, 0o644)
	var keys []string
	for k, v := range im.errs {
		keys = append(keys, fmt.Sprintf("%s=%d", strings.TrimPrefix(k, modPrefix), v))
	}
	sort.Strings(keys)
	fmt.Fprintln(os.Stderr, "type errors per package:", strings.Join(keys, " "))
	fmt.Fprintln(os.Stderr, "entries:", len(list))
}
