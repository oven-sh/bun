package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

type decl struct {
	Pkg    string `json:"pkg"`
	File   string `json:"file"`
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Line   int    `json:"line"`
	End    int    `json:"end"`
	Sig    string `json:"sig,omitempty"`
	Panics int    `json:"panics,omitempty"`
}

func main() {
	root := "/workspace/ref/typescript-go/internal/"
	var out []decl
	for _, pkg := range os.Args[2:] {
		ents, _ := os.ReadDir(root + pkg)
		for _, e := range ents {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
				continue
			}
			fset := token.NewFileSet()
			fn := filepath.Join(root+pkg, e.Name())
			f, err := parser.ParseFile(fset, fn, nil, parser.ParseComments|parser.SkipObjectResolution)
			if err != nil {
				continue
			}
			for _, d := range f.Decls {
				switch x := d.(type) {
				case *ast.FuncDecl:
					name := x.Name.Name
					kind := "func"
					if x.Recv != nil && len(x.Recv.List) > 0 {
						var sb strings.Builder
						t := x.Recv.List[0].Type
						if se, ok := t.(*ast.StarExpr); ok {
							t = se.X
						}
						if ie, ok := t.(*ast.IndexExpr); ok {
							t = ie.X
						}
						if ie, ok := t.(*ast.IndexListExpr); ok {
							t = ie.X
						}
						printer.Fprint(&sb, fset, t)
						name = sb.String() + "." + name
						kind = "method"
					}
					var sb strings.Builder
					printer.Fprint(&sb, fset, x.Type)
					panics := 0
					if x.Body != nil {
						ast.Inspect(x.Body, func(n ast.Node) bool {
							if c, ok := n.(*ast.CallExpr); ok {
								if id, ok := c.Fun.(*ast.Ident); ok && id.Name == "panic" {
									panics++
								}
							}
							return true
						})
					}
					out = append(out, decl{pkg, pkg + "/" + e.Name(), kind, name, fset.Position(x.Pos()).Line, fset.Position(x.End()).Line, strings.Join(strings.Fields(sb.String()), " "), panics})
				case *ast.GenDecl:
					for _, s := range x.Specs {
						switch sp := s.(type) {
						case *ast.TypeSpec:
							out = append(out, decl{pkg, pkg + "/" + e.Name(), "type", sp.Name.Name, fset.Position(sp.Pos()).Line, fset.Position(sp.End()).Line, "", 0})
						case *ast.ValueSpec:
							k := "var"
							if x.Tok == token.CONST {
								k = "const"
							}
							for _, n := range sp.Names {
								out = append(out, decl{pkg, pkg + "/" + e.Name(), k, n.Name, fset.Position(sp.Pos()).Line, fset.Position(sp.End()).Line, "", 0})
							}
						}
					}
				}
			}
		}
	}
	b, _ := json.MarshalIndent(out, "", " ")
	os.WriteFile(os.Args[1], b, 0o644)
}
