// Oracle for parser.ParseIsolatedEntityName of typescript-go (89d5d5b): one hex-encoded input per line in, one line out.
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/parser"
)

func dump(sb *strings.Builder, n *ast.Node) {
	js := n.Flags&ast.NodeFlagsJavaScriptFile != 0
	switch n.Kind {
	case ast.KindIdentifier:
		fmt.Fprintf(sb, "Id(%s,%d,%d,js=%v)", hex.EncodeToString([]byte(n.Text())), n.Pos(), n.End(), js)
	case ast.KindQualifiedName:
		q := n.AsQualifiedName()
		fmt.Fprintf(sb, "Q(%d,%d,js=%v,", n.Pos(), n.End(), js)
		dump(sb, q.Left)
		sb.WriteString(",")
		dump(sb, q.Right)
		fmt.Fprintf(sb, ",lp=%v,rp=%v)", q.Left.Parent == n, q.Right.Parent == n)
	default:
		fmt.Fprintf(sb, "?%d", n.Kind)
	}
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		raw, err := hex.DecodeString(sc.Text())
		if err != nil {
			fmt.Fprintln(w, "bad input")
			continue
		}
		r := parser.ParseIsolatedEntityName(string(raw))
		if r == nil {
			fmt.Fprintln(w, "nil")
			continue
		}
		var sb strings.Builder
		dump(&sb, r)
		fmt.Fprintln(w, sb.String())
	}
}
