// Research probe: rewrites a copy of typescript-go's internal/parser so that every function records that it was entered,
// and whether that happened while parseJSDocComment was on the stack. Writes zz_probe.go with the tables.
// usage: instrument <dir of the copied package> [package name, default parser]
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	dir := os.Args[1]
	pkgName := "parser"
	if len(os.Args) > 2 {
		pkgName = os.Args[2]
	}
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(fi os.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go") && fi.Name() != "zz_probe.go"
	}, parser.ParseComments)
	if err != nil {
		panic(err)
	}
	var names []string
	var paths []string
	files := map[string]*ast.File{}
	for _, pkg := range pkgs {
		for path, f := range pkg.Files {
			paths = append(paths, path)
			files[path] = f
		}
	}
	sort.Strings(paths)
	for _, path := range paths {
		f := files[path]
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			name := fd.Name.Name
			if fd.Recv != nil && len(fd.Recv.List) == 1 {
				t := fd.Recv.List[0].Type
				if s, ok := t.(*ast.StarExpr); ok {
					t = s.X
				}
				if id, ok := t.(*ast.Ident); ok {
					name = id.Name + "." + name
				}
			}
			idx := len(names)
			names = append(names, fmt.Sprintf("%s\t%d\t%d\t%s", filepath.Base(path), fset.Position(fd.Pos()).Line, fset.Position(fd.End()).Line, name))
			probe := &ast.ExprStmt{X: &ast.CallExpr{Fun: ast.NewIdent("jsdocProbe"), Args: []ast.Expr{&ast.BasicLit{Kind: token.INT, Value: fmt.Sprint(idx)}}}}
			stmts := []ast.Stmt{}
			if fd.Name.Name == "parseJSDocComment" {
				stmts = append(stmts,
					&ast.IncDecStmt{X: ast.NewIdent("JSDocDepth"), Tok: token.INC},
					&ast.DeferStmt{Call: &ast.CallExpr{Fun: ast.NewIdent("jsdocLeave")}},
				)
			}
			stmts = append(stmts, probe)
			fd.Body.List = append(stmts, fd.Body.List...)
		}
		var buf bytes.Buffer
		if err := format.Node(&buf, fset, f); err != nil {
			panic(err)
		}
		if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
			panic(err)
		}
	}
	var b strings.Builder
	b.WriteString("package " + pkgName + "\n\n")
	fmt.Fprintf(&b, "var JSDocDepth int\nvar JSDocEntered [%d]int64\nvar AllEntered [%d]int64\n\n", len(names), len(names))
	b.WriteString("func jsdocLeave() { JSDocDepth-- }\n\nfunc JSDocLeave() { JSDocDepth-- }\n\n")
	b.WriteString("func jsdocProbe(i int) {\n\tAllEntered[i]++\n\tif JSDocDepth > 0 {\n\t\tJSDocEntered[i]++\n\t}\n}\n\n")
	b.WriteString("var ProbeNames = []string{\n")
	for _, n := range names {
		fmt.Fprintf(&b, "\t%q,\n", n)
	}
	b.WriteString("}\n")
	if err := os.WriteFile(filepath.Join(dir, "zz_probe.go"), []byte(b.String()), 0o644); err != nil {
		panic(err)
	}
	fmt.Println("instrumented", len(names), "functions")
}
