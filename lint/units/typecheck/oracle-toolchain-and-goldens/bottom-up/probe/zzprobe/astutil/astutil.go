// Research probe: the single-node utilities of internal/ast/utilities.go on every node of a file ("astutil-dump v1").
// The function tables are generated from the reference (tools/gen_astutil.py), so the list cannot drift from it.
// usage: astutil [-bind] [-force] [-jsx] <outdir|-> <virtual-name>=<path>...      one <name>.astutil.txt per file
// One line per node, numbered as in the bind dump (pre-order of ForEachChild):
//   n<i> Kind<Name> [pos,end) <Fn>... <Fn>=n<j>... <Fn>=0x<value>... <Fn>="<text>"...
// A bool function is named when it returns true, a node function when it returns a node (n<j>, or ?Kind[pos,end) for a
// node outside the walk), a flags or enum function when its value is not zero, a string function when not empty.
// "<Fn>!" says that the reference panics for this node: the port reports an internal diagnostic there.
package astutil

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/binder"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/tspath"
)

type boolFn struct {
	name string
	f    func(*ast.Node) bool
}

type nodeFn struct {
	name string
	f    func(*ast.Node) *ast.Node
}

type intFn struct {
	name string
	f    func(*ast.Node) int64
}

type stringFn struct {
	name string
	f    func(*ast.Node) string
}

func call[T any](f func(*ast.Node) T, n *ast.Node) (value T, panicked bool) {
	defer func() {
		if recover() != nil {
			panicked = true
		}
	}()
	return f(n), false
}

func Main() {
	args := os.Args[1:]
	var opts ast.ExternalModuleIndicatorOptions
	bind := false
	for len(args) > 0 && args[0] != "-" && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-bind":
			bind = true
		case "-force":
			opts.Force = true
		case "-jsx":
			opts.JSX = true
		}
		args = args[1:]
	}
	outdir := args[0]
	for _, a := range args[1:] {
		eq := strings.Index(a, "=")
		name, path := a[:eq], a[eq+1:]
		b, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		text := strings.TrimPrefix(string(b), "\ufeff")
		fileName := tspath.NormalizePath("/" + name)
		sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName:                       fileName,
			Path:                           tspath.Path(fileName),
			ExternalModuleIndicatorOptions: opts,
		}, text, core.EnsureScriptKindFromFileName(fileName))
		if bind {
			binder.BindSourceFile(sf)
		}
		var order []*ast.Node
		index := map[*ast.Node]int{}
		stack := []*ast.Node{sf.AsNode()}
		var children []*ast.Node
		add := func(c *ast.Node) bool {
			children = append(children, c)
			return false
		}
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if _, ok := index[n]; ok {
				continue
			}
			index[n] = len(order)
			order = append(order, n)
			children = children[:0]
			n.ForEachChild(add)
			for i := len(children) - 1; i >= 0; i-- {
				stack = append(stack, children[i])
			}
		}
		w := bufio.NewWriter(os.Stdout)
		var out *os.File
		if outdir != "-" {
			out, err = os.Create(filepath.Join(outdir, strings.ReplaceAll(name, "/", "__")+".astutil.txt"))
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			w = bufio.NewWriter(out)
		}
		fmt.Fprintf(w, "astutil-dump v1\nfile %s nodes=%d bound=%v functions=%d\n", fileName, len(order), bind, len(boolFns)+len(nodeFns)+len(intFns)+len(stringFns))
		for i, n := range order {
			fmt.Fprintf(w, "n%d %s [%d,%d)", i, n.Kind.String(), n.Pos(), n.End())
			for _, fn := range boolFns {
				if v, panicked := call(fn.f, n); panicked {
					fmt.Fprintf(w, " %s!", fn.name)
				} else if v {
					fmt.Fprintf(w, " %s", fn.name)
				}
			}
			for _, fn := range nodeFns {
				if v, panicked := call(fn.f, n); panicked {
					fmt.Fprintf(w, " %s!", fn.name)
				} else if v != nil {
					if j, ok := index[v]; ok {
						fmt.Fprintf(w, " %s=n%d", fn.name, j)
					} else {
						fmt.Fprintf(w, " %s=?%s[%d,%d)", fn.name, v.Kind.String(), v.Pos(), v.End())
					}
				}
			}
			for _, fn := range intFns {
				if v, panicked := call(fn.f, n); panicked {
					fmt.Fprintf(w, " %s!", fn.name)
				} else if v != 0 {
					fmt.Fprintf(w, " %s=%#x", fn.name, v)
				}
			}
			for _, fn := range stringFns {
				if v, panicked := call(fn.f, n); panicked {
					fmt.Fprintf(w, " %s!", fn.name)
				} else if v != "" {
					fmt.Fprintf(w, " %s=%s", fn.name, strconv.QuoteToASCII(v))
				}
			}
			fmt.Fprintf(w, "\n")
		}
		w.Flush()
		if out != nil {
			out.Close()
		}
	}
}
