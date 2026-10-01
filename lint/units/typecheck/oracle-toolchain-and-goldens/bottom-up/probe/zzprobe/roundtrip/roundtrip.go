// Research probe: the reference's emit printer on synthetic nodes, without a checker.
// Reads one text per line on stdin and tries three readings of it, in this order:
//   TYPE  `type __T = <text>;`     the type node, printed as Checker.typeToStringEx prints (text writer, remove comments)
//   SIG   `type __T = { <text> }`  the single member, printed as Checker.signatureToStringEx prints (single line writer,
//                                   trailing semicolon omitted, never ASCII-escape)
//   EXPR  `(<text>);`              the expression, printed as Checker.symbolToStringEx prints (same writer and options as SIG)
// The node is deep-cloned with an emit context factory first (synthetic positions, as the node builder's reuse path
// does); type literals, tuples, mapped types and binding patterns are marked single-line and literals and identifiers
// as not ASCII-escaped, as the node builder does. One output line per input and accepted reading:
//   <reading>-SAME|<reading>-DIFF <tab> input <tab> output        or        NONE <tab> input <tab>
// With the argument "all" every accepted reading is printed, otherwise only the first.
package roundtrip

import (
	"bufio"
	"fmt"
	"os"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/printer"
)

func parse(src string) *ast.SourceFile {
	sf := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/t.ts", Path: "/t.ts"}, src, core.ScriptKindTS)
	if len(sf.Diagnostics()) > 0 || len(sf.Statements.Nodes) != 1 {
		return nil
	}
	return sf
}

func clone(ec *printer.EmitContext, node *ast.Node) *ast.Node {
	c := ec.Factory.AsNodeFactory().DeepCloneNode(node)
	var mark func(n *ast.Node) bool
	mark = func(n *ast.Node) bool {
		switch n.Kind {
		case ast.KindTypeLiteral, ast.KindTupleType, ast.KindMappedType, ast.KindObjectBindingPattern, ast.KindArrayBindingPattern:
			ec.AddEmitFlags(n, printer.EFSingleLine)
		case ast.KindStringLiteral, ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail, ast.KindNoSubstitutionTemplateLiteral, ast.KindIdentifier:
			ec.AddEmitFlags(n, printer.EFNoAsciiEscaping)
		}
		n.ForEachChild(mark)
		return false
	}
	mark(c)
	return c
}

func asType(text string) (string, bool) {
	src := "type __T = " + text + ";"
	sf := parse(src)
	if sf == nil || sf.Statements.Nodes[0].Kind != ast.KindTypeAliasDeclaration {
		return "", false
	}
	typeNode := sf.Statements.Nodes[0].AsTypeAliasDeclaration().Type
	if typeNode == nil || typeNode.End() != len(src)-1 {
		return "", false
	}
	ec := printer.NewEmitContext()
	p := printer.NewPrinter(printer.PrinterOptions{RemoveComments: true}, printer.PrintHandlers{}, ec)
	w := printer.NewTextWriter("", 0)
	p.Write(clone(ec, typeNode), nil, w, nil)
	return w.String(), true
}

func singleLine(ec *printer.EmitContext, node *ast.Node) string {
	p := printer.NewPrinter(printer.PrinterOptions{RemoveComments: true, OmitTrailingSemicolon: true, NeverAsciiEscape: true}, printer.PrintHandlers{}, ec)
	w, put := printer.GetSingleLineStringWriter()
	defer put()
	p.Write(node, nil, w, nil)
	return w.String()
}

func asSignature(text string) (string, bool) {
	src := "type __T = { " + text + " }"
	sf := parse(src)
	if sf == nil || sf.Statements.Nodes[0].Kind != ast.KindTypeAliasDeclaration {
		return "", false
	}
	typeNode := sf.Statements.Nodes[0].AsTypeAliasDeclaration().Type
	if typeNode == nil || typeNode.Kind != ast.KindTypeLiteral || len(typeNode.AsTypeLiteralNode().Members.Nodes) != 1 {
		return "", false
	}
	member := typeNode.AsTypeLiteralNode().Members.Nodes[0]
	if member.Kind != ast.KindCallSignature && member.Kind != ast.KindConstructSignature {
		return "", false
	}
	ec := printer.NewEmitContext()
	return singleLine(ec, clone(ec, member)), true
}

func asExpression(text string) (string, bool) {
	src := "(" + text + ");"
	sf := parse(src)
	if sf == nil || sf.Statements.Nodes[0].Kind != ast.KindExpressionStatement {
		return "", false
	}
	expr := sf.Statements.Nodes[0].AsExpressionStatement().Expression
	if expr.Kind != ast.KindParenthesizedExpression || expr.End() != len(src)-1 {
		return "", false
	}
	inner := expr.AsParenthesizedExpression().Expression
	switch inner.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindStringLiteral:
	default:
		return "", false
	}
	ec := printer.NewEmitContext()
	return singleLine(ec, clone(ec, inner)), true
}

func Main() {
	all := len(os.Args) > 1 && os.Args[1] == "all"
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	readings := []struct {
		name string
		f    func(string) (string, bool)
	}{{"TYPE", asType}, {"SIG", asSignature}, {"EXPR", asExpression}}
	for sc.Scan() {
		text := sc.Text()
		n := 0
		for _, r := range readings {
			res, ok := r.f(text)
			if !ok {
				continue
			}
			n++
			status := "DIFF"
			if res == text {
				status = "SAME"
			}
			fmt.Fprintf(out, "%s-%s\t%s\t%s\n", r.name, status, text, res)
			if !all {
				break
			}
		}
		if n == 0 {
			fmt.Fprintf(out, "NONE\t%s\t\n", text)
		}
	}
}
