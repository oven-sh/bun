// Research probe: syntactic call graph of typescript-go's parser package, and the closure reached from jsdoc.go and reparser.go.
// usage: go run . <parser dir> [root file...]
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
	name  string
	file  string
	line  int
	lines int
	calls map[string]bool
	state map[string]bool
}

func main() {
	dir := os.Args[1]
	roots := os.Args[2:]
	fset := token.NewFileSet()
	files, _ := filepath.Glob(filepath.Join(dir, "*.go"))
	fns := map[string]*fn{}
	var order []*fn
	parsed := map[string]*ast.File{}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		af, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			panic(err)
		}
		parsed[filepath.Base(f)] = af
		for _, d := range af.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			start := fset.Position(fd.Pos()).Line
			end := fset.Position(fd.End()).Line
			x := &fn{name: fd.Name.Name, file: filepath.Base(f), line: start, lines: end - start + 1, calls: map[string]bool{}, state: map[string]bool{}}
			if _, dup := fns[x.name]; dup {
				fmt.Fprintln(os.Stderr, "duplicate name", x.name)
			}
			fns[x.name] = x
			order = append(order, x)
		}
	}
	// parser struct fields
	fields := map[string]bool{}
	for _, af := range parsed {
		ast.Inspect(af, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok || ts.Name.Name != "Parser" {
				return true
			}
			st := ts.Type.(*ast.StructType)
			for _, f := range st.Fields.List {
				for _, nm := range f.Names {
					fields[nm.Name] = true
				}
			}
			return false
		})
	}
	for base, af := range parsed {
		for _, d := range af.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			x := fns[fd.Name.Name]
			_ = base
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				switch v := n.(type) {
				case *ast.SelectorExpr:
					if id, ok := v.X.(*ast.Ident); ok && id.Name == "p" {
						if _, ok := fns[v.Sel.Name]; ok {
							x.calls[v.Sel.Name] = true
						}
						if fields[v.Sel.Name] {
							x.state[v.Sel.Name] = true
						}
					}
					// (*Parser).name
					if pe, ok := v.X.(*ast.ParenExpr); ok {
						if se, ok := pe.X.(*ast.StarExpr); ok {
							if id, ok := se.X.(*ast.Ident); ok && id.Name == "Parser" {
								if _, ok := fns[v.Sel.Name]; ok {
									x.calls[v.Sel.Name] = true
								}
							}
						}
					}
				case *ast.CallExpr:
					if id, ok := v.Fun.(*ast.Ident); ok {
						if _, ok := fns[id.Name]; ok {
							x.calls[id.Name] = true
						}
					}
				case *ast.Ident:
					// bare reference to a package function used as a value
					if f, ok := fns[v.Name]; ok && v.Obj == nil && f != nil {
						x.calls[v.Name] = true
					}
				}
				return true
			})
		}
	}
	total := map[string]int{}
	for _, x := range order {
		total[x.file] += x.lines
	}
	if len(roots) == 0 {
		for _, x := range order {
			var c []string
			for k := range x.calls {
				c = append(c, k)
			}
			sort.Strings(c)
			var s []string
			for k := range x.state {
				s = append(s, k)
			}
			sort.Strings(s)
			fmt.Printf("%s\t%s:%d\t%d\t%s\t%s\n", x.name, x.file, x.line, x.lines, strings.Join(c, ","), strings.Join(s, ","))
		}
		return
	}
	reach := map[string]bool{}
	var stack []string
	rootSet := map[string]bool{}
	for _, r := range roots {
		rootSet[r] = true
	}
	for _, x := range order {
		if rootSet[x.file] || rootSet[x.name] {
			reach[x.name] = true
			stack = append(stack, x.name)
		}
	}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for c := range fns[n].calls {
			if !reach[c] {
				reach[c] = true
				stack = append(stack, c)
			}
		}
	}
	sum := map[string]int{}
	cnt := map[string]int{}
	allcnt := map[string]int{}
	for _, x := range order {
		allcnt[x.file]++
		if reach[x.name] {
			sum[x.file] += x.lines
			cnt[x.file]++
		}
	}
	for f := range total {
		fmt.Printf("file %s: reached %d of %d functions, %d of %d function lines\n", f, cnt[f], allcnt[f], sum[f], total[f])
	}
	fmt.Println("-- not reached:")
	for _, x := range order {
		if !reach[x.name] {
			fmt.Printf("  %s\t%s:%d\t%d\n", x.name, x.file, x.line, x.lines)
		}
	}
}
