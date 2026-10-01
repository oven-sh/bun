// Research tool: lists every function declaration of the Go files under the given directories.
// Output: file<TAB>line of the func keyword<TAB>last line<TAB>receiver.name
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
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
	root := os.Args[1]
	fset := token.NewFileSet()
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			name := fd.Name.Name
			if r := recvName(fd); r != "" {
				name = r + "." + name
			}
			fmt.Printf("%s\t%d\t%d\t%s\n", rel, fset.Position(fd.Pos()).Line, fset.Position(fd.End()).Line, name)
		}
		return nil
	})
}
