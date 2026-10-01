package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"strings"
)

func recvName(fd *ast.FuncDecl) string {
	if fd.Recv != nil && len(fd.Recv.List) > 0 {
		var sb strings.Builder
		printer.Fprint(&sb, token.NewFileSet(), fd.Recv.List[0].Type)
		return sb.String()
	}
	return ""
}

func main() {
	fset := token.NewFileSet()
	for _, fn := range os.Args[1:] {
		f, err := parser.ParseFile(fset, fn, nil, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		for _, d := range f.Decls {
			switch x := d.(type) {
			case *ast.FuncDecl:
				start := fset.Position(x.Pos()).Line
				if x.Doc != nil {
					start = fset.Position(x.Doc.Pos()).Line
				}
				end := fset.Position(x.End()).Line
				r := recvName(x)
				name := x.Name.Name
				if r != "" {
					name = "(" + r + ")." + name
				}
				fmt.Printf("func\t%d\t%d\t%d\t%s\n", start, end, end-start+1, name)
			case *ast.GenDecl:
				start := fset.Position(x.Pos()).Line
				if x.Doc != nil {
					start = fset.Position(x.Doc.Pos()).Line
				}
				end := fset.Position(x.End()).Line
				var names []string
				for _, s := range x.Specs {
					switch sp := s.(type) {
					case *ast.TypeSpec:
						names = append(names, sp.Name.Name)
					case *ast.ValueSpec:
						for _, n := range sp.Names {
							names = append(names, n.Name)
						}
					}
				}
				nm := strings.Join(names, ",")
				if len(nm) > 120 {
					nm = nm[:120] + "..."
				}
				fmt.Printf("%s\t%d\t%d\t%d\t%s\n", x.Tok.String(), start, end, end-start+1, nm)
			}
		}
	}
}
