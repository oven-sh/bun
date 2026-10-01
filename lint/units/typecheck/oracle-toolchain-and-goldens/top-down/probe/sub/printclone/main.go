// Imported from units/typecheck/checker-type-printer/top-down/groundtruth/rtprobe_main.go.txt by import-legacy.sh. Do not edit here.
// Research probe: parses each input line as a type, deep clones the type node into an emit context, marks it the way
// the checker's node builder marks its nodes, prints it with the checker's type printer settings and compares.
// usage: rtprobe <file with one type text per line> [strip|single]   (strip: parenthesized type nodes are removed
// first; single: the same, printed with the single line writer and the trailing semicolon omitted)
//     output: ok|diff|noparse|panic <tab> text [<tab> printed]
package printclone

import (
	"bufio"
	"fmt"
	"os"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/printer"
)

var stripParens, singleLine bool

func roundTrip(text string) (status string, out string) {
	defer func() {
		if r := recover(); r != nil {
			status = "panic"
			out = fmt.Sprint(r)
		}
	}()
	src := "type __T = " + text + ";"
	sf := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/t.ts", Path: "/t.ts"}, src, core.ScriptKindTS)
	if len(sf.Diagnostics()) > 0 || len(sf.Statements.Nodes) != 1 || sf.Statements.Nodes[0].Kind != ast.KindTypeAliasDeclaration {
		return "noparse", ""
	}
	typeNode := sf.Statements.Nodes[0].AsTypeAliasDeclaration().Type
	ec := printer.NewEmitContext()
	if stripParens {
		// the node builder never makes parenthesized type nodes: the printer adds parentheses by precedence
		var v *ast.NodeVisitor
		v = ast.NewNodeVisitor(func(n *ast.Node) *ast.Node {
			if n.Kind == ast.KindParenthesizedType {
				return v.VisitNode(n.AsParenthesizedTypeNode().Type)
			}
			return v.VisitEachChild(n)
		}, ec.Factory.AsNodeFactory(), ast.NodeVisitorHooks{})
		typeNode = v.VisitNode(typeNode)
	}
	clone := ec.Factory.DeepCloneNode(typeNode)
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		// a clone keeps the flags of the parsed node: the node builder's own nodes are marked as synthesized
		n.Flags |= ast.NodeFlagsSynthesized
		switch n.Kind {
		case ast.KindTypeLiteral, ast.KindTupleType, ast.KindMappedType:
			ec.AddEmitFlags(n, printer.EFSingleLine)
		case ast.KindStringLiteral, ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail, ast.KindNoSubstitutionTemplateLiteral, ast.KindIdentifier:
			ec.AddEmitFlags(n, printer.EFNoAsciiEscaping)
		}
		n.ForEachChild(visit)
		return false
	}
	visit(clone)
	if singleLine {
		// the settings of symbolToStringEx and signatureToStringEx: single line writer, trailing semicolon omitted
		p := printer.NewPrinter(printer.PrinterOptions{RemoveComments: true, OmitTrailingSemicolon: true, NeverAsciiEscape: true}, printer.PrintHandlers{}, ec)
		w, put := printer.GetSingleLineStringWriter()
		defer put()
		p.Write(clone, nil, w, nil)
		out = w.String()
	} else {
		p := printer.NewPrinter(printer.PrinterOptions{RemoveComments: true}, printer.PrintHandlers{}, ec)
		w := printer.NewTextWriter("", 0)
		p.Write(clone, nil, w, nil)
		out = w.String()
	}
	if out == text {
		return "ok", ""
	}
	return "diff", out
}

func Main() {
	stripParens = len(os.Args) > 2
	singleLine = len(os.Args) > 2 && os.Args[2] == "single"
	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		text := sc.Text()
		status, out := roundTrip(text)
		if out != "" {
			fmt.Fprintf(w, "%s\t%s\t%s\n", status, text, out)
		} else {
			fmt.Fprintf(w, "%s\t%s\n", status, text)
		}
	}
}
