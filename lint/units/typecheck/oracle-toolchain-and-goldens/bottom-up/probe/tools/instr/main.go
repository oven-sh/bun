// Research tool: adds `defer relEnter("name")()` as the first statement of every function of a COPY of a checker file.
// usage: instr <file.go>...      the file is rewritten in place, never run on the reference
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"sort"
)

func main() {
	for _, path := range os.Args[1:] {
		src, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, src, parser.ParseComments)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		type ins struct {
			off  int
			text string
		}
		var list []ins
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			name := fd.Name.Name
			if fd.Recv != nil && len(fd.Recv.List) > 0 {
				var sb bytes.Buffer
				printer.Fprint(&sb, token.NewFileSet(), fd.Recv.List[0].Type)
				recv := sb.String()
				for len(recv) > 0 && recv[0] == '*' {
					recv = recv[1:]
				}
				name = recv + "." + name
			}
			line := fset.Position(fd.Pos()).Line
			off := fset.Position(fd.Body.Lbrace).Offset + 1
			list = append(list, ins{off, fmt.Sprintf(" defer relEnter(%q, %d)(); ", name, line)})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].off > list[j].off })
		out := src
		for _, i := range list {
			out = append(out[:i.off:i.off], append([]byte(i.text), out[i.off:]...)...)
		}
		if err := os.WriteFile(path, out, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
