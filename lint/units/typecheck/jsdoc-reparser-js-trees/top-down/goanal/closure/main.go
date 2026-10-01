// Research probe: the call closure inside typescript-go's internal/parser that jsdoc.go and reparser.go reach.
// Names are resolved without type information: a selector on the receiver (or on a parameter of type *Parser),
// a method expression (*Parser).name, or a bare identifier that names a function of the package.
// usage: closure <dir of internal/parser> [-cut name,name...] [-roots file.go,file.go | -rootfuncs name,name]
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type fn struct {
	key   string
	file  string
	start int
	end   int
	calls map[string]bool
	recv  string
}

func main() {
	dir := os.Args[1]
	cut := map[string]bool{}
	rootFiles := map[string]bool{"jsdoc.go": true, "reparser.go": true}
	var rootFuncs []string
	table, quiet := false, false
	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-cut":
			i++
			for _, n := range strings.Split(os.Args[i], ",") {
				cut[n] = true
			}
		case "-roots":
			i++
			rootFiles = map[string]bool{}
			for _, n := range strings.Split(os.Args[i], ",") {
				rootFiles[n] = true
			}
		case "-rootfuncs":
			i++
			rootFiles = map[string]bool{}
			rootFuncs = strings.Split(os.Args[i], ",")
		case "-table":
			table = true
		case "-quiet":
			quiet = true
		}
	}
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(fi os.FileInfo) bool { return !strings.HasSuffix(fi.Name(), "_test.go") }, 0)
	if err != nil {
		panic(err)
	}
	funcs := map[string]*fn{}
	var decls []*ast.FuncDecl
	declFile := map[*ast.FuncDecl]string{}
	for _, pkg := range pkgs {
		for path, f := range pkg.Files {
			for _, d := range f.Decls {
				if fd, ok := d.(*ast.FuncDecl); ok {
					decls = append(decls, fd)
					declFile[fd] = filepath.Base(path)
				}
			}
		}
	}
	keyOf := func(fd *ast.FuncDecl) (string, string) {
		if fd.Recv != nil && len(fd.Recv.List) == 1 {
			t := fd.Recv.List[0].Type
			if s, ok := t.(*ast.StarExpr); ok {
				t = s.X
			}
			if id, ok := t.(*ast.Ident); ok {
				return id.Name + "." + fd.Name.Name, id.Name
			}
		}
		return fd.Name.Name, ""
	}
	for _, fd := range decls {
		k, recv := keyOf(fd)
		funcs[k] = &fn{key: k, file: declFile[fd], start: fset.Position(fd.Pos()).Line, end: fset.Position(fd.End()).Line, calls: map[string]bool{}, recv: recv}
	}
	isParserType := func(t ast.Expr) bool {
		if s, ok := t.(*ast.StarExpr); ok {
			t = s.X
		}
		id, ok := t.(*ast.Ident)
		return ok && id.Name == "Parser"
	}
	for _, fd := range decls {
		if fd.Body == nil {
			continue
		}
		k, _ := keyOf(fd)
		self := funcs[k]
		parserVars := map[string]bool{"p": true}
		if fd.Recv != nil && len(fd.Recv.List) == 1 && isParserType(fd.Recv.List[0].Type) {
			for _, n := range fd.Recv.List[0].Names {
				parserVars[n.Name] = true
			}
		}
		// Every parameter of type *Parser, of the function and of the literals inside it.
		ast.Inspect(fd, func(n ast.Node) bool {
			if ft, ok := n.(*ast.FuncType); ok && ft.Params != nil {
				for _, p := range ft.Params.List {
					if isParserType(p.Type) {
						for _, nm := range p.Names {
							parserVars[nm.Name] = true
						}
					}
				}
			}
			return true
		})
		ast.Inspect(fd.Body, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.SelectorExpr:
				name := x.Sel.Name
				switch r := x.X.(type) {
				case *ast.Ident:
					if parserVars[r.Name] {
						if _, ok := funcs["Parser."+name]; ok {
							self.calls["Parser."+name] = true
						}
					}
				case *ast.ParenExpr:
					if isParserType(r.X) {
						if _, ok := funcs["Parser."+name]; ok {
							self.calls["Parser."+name] = true
						}
					}
				}
			case *ast.Ident:
				if f, ok := funcs[x.Name]; ok && f.recv == "" && x.Obj == nil {
					self.calls[x.Name] = true
				} else if ok && f.recv == "" && x.Obj != nil && x.Obj.Kind == ast.Fun {
					self.calls[x.Name] = true
				}
			}
			return true
		})
	}
	if table {
		var ks []string
		for k := range funcs {
			ks = append(ks, k)
		}
		sort.Slice(ks, func(i, j int) bool {
			a, b := funcs[ks[i]], funcs[ks[j]]
			if a.file != b.file {
				return a.file < b.file
			}
			return a.start < b.start
		})
		for _, k := range ks {
			f := funcs[k]
			fmt.Printf("%s\t%d\t%d\t%s\n", f.file, f.start, f.end, k)
		}
		return
	}
	// Roots.
	var work []string
	seen := map[string]bool{}
	for k, f := range funcs {
		if rootFiles[f.file] {
			work = append(work, k)
		}
	}
	for _, r := range rootFuncs {
		if _, ok := funcs[r]; !ok {
			fmt.Fprintln(os.Stderr, "no function", r)
			os.Exit(1)
		}
		work = append(work, r)
	}
	sort.Strings(work)
	via := map[string]string{}
	for len(work) > 0 {
		k := work[0]
		work = work[1:]
		if seen[k] || cut[k] {
			continue
		}
		seen[k] = true
		var cs []string
		for c := range funcs[k].calls {
			cs = append(cs, c)
		}
		sort.Strings(cs)
		for _, c := range cs {
			if !seen[c] && !cut[c] {
				if _, ok := via[c]; !ok {
					via[c] = k
				}
				work = append(work, c)
			}
		}
	}
	var keys []string
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := funcs[keys[i]], funcs[keys[j]]
		if a.file != b.file {
			return a.file < b.file
		}
		return a.start < b.start
	})
	perFile := map[string][2]int{}
	allPerFile := map[string][2]int{}
	for _, f := range funcs {
		v := allPerFile[f.file]
		v[0]++
		v[1] += f.end - f.start + 1
		allPerFile[f.file] = v
	}
	fmt.Println("file\tstart\tend\tlines\tfunction\treached from")
	for _, k := range keys {
		f := funcs[k]
		n := f.end - f.start + 1
		v := perFile[f.file]
		v[0]++
		v[1] += n
		perFile[f.file] = v
		fmt.Printf("%s\t%d\t%d\t%d\t%s\t%s\n", f.file, f.start, f.end, n, k, via[k])
	}
	var files []string
	for f := range allPerFile {
		files = append(files, f)
	}
	sort.Strings(files)
	tf, tl, af, al := 0, 0, 0, 0
	for _, f := range files {
		v, a := perFile[f], allPerFile[f]
		fmt.Printf("# %s: %d of %d functions, %d of %d function lines\n", f, v[0], a[0], v[1], a[1])
		tf += v[0]
		tl += v[1]
		af += a[0]
		al += a[1]
	}
	fmt.Printf("# total: %d of %d functions, %d of %d function lines\n", tf, af, tl, al)
	// Functions of parser.go that the closure does not reach.
	var rest []string
	for k, f := range funcs {
		if !seen[k] && f.file == "parser.go" {
			rest = append(rest, fmt.Sprintf("%s(%d)", k, f.end-f.start+1))
		}
	}
	sort.Strings(rest)
	if !quiet {
		fmt.Printf("# parser.go functions outside the closure (%d): %s\n", len(rest), strings.Join(rest, " "))
	}
}
