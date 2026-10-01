// Research probe: prints what parser.ParseIsolatedEntityName returns for each line of standard input (escapes \n \t \\ are decoded).
package pien

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/parser"
)

func show(n *ast.Node) string {
	if n == nil {
		return "nil"
	}
	switch n.Kind {
	case ast.KindIdentifier:
		return fmt.Sprintf("Identifier(%q)[%d,%d)", n.Text(), n.Pos(), n.End())
	case ast.KindQualifiedName:
		q := n.AsQualifiedName()
		return fmt.Sprintf("QualifiedName(%s, %s)[%d,%d)", show(q.Left), show(q.Right), n.Pos(), n.End())
	}
	return n.Kind.String()
}

func Main() {
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		raw := sc.Text()
		text := strings.NewReplacer(`\n`, "\n", `\t`, "\t", `\\`, `\`).Replace(raw)
		fmt.Printf("%q => %s\n", text, show(parser.ParseIsolatedEntityName(text)))
	}
}
