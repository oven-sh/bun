package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
)

func recvName(fd *ast.FuncDecl) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return ""
	}
	t := fd.Recv.List[0].Type
	for {
		switch x := t.(type) {
		case *ast.StarExpr:
			t = x.X
			continue
		case *ast.IndexExpr:
			t = x.X
			continue
		case *ast.IndexListExpr:
			t = x.X
			continue
		case *ast.Ident:
			return x.Name
		}
		return "?"
	}
}

func main() {
	fset := token.NewFileSet()
	for _, path := range os.Args[1:] {
		f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		for _, d := range f.Decls {
			start := fset.Position(d.Pos()).Line
			end := fset.Position(d.End()).Line
			switch x := d.(type) {
			case *ast.FuncDecl:
				if x.Doc != nil {
					start = fset.Position(x.Doc.Pos()).Line
				}
				r := recvName(x)
				name := x.Name.Name
				if r != "" {
					name = r + "." + name
				}
				fmt.Printf("%d\t%d\tfunc\t%s\n", start, end, name)
			case *ast.GenDecl:
				if x.Doc != nil {
					start = fset.Position(x.Doc.Pos()).Line
				}
				var names []string
				for _, s := range x.Specs {
					switch y := s.(type) {
					case *ast.TypeSpec:
						names = append(names, y.Name.Name)
					case *ast.ValueSpec:
						for _, n := range y.Names {
							names = append(names, n.Name)
						}
					}
				}
				if x.Tok == token.IMPORT {
					continue
				}
				s := strings.Join(names, ",")
				if len(s) > 100 {
					s = s[:100] + "..."
				}
				fmt.Printf("%d\t%d\t%s\t%s\n", start, end, x.Tok.String(), s)
			}
		}
	}
}
