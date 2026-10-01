// Imported from units/typecheck/ts-dump-and-test-importer/groundtruth/dumpast/main.go by import-legacy.sh. Do not edit here.
// Research probe: prints the tree that typescript-go's parser builds, in a canonical text form.
// usage: dumpast [-force] [-jsx] [-nojsdoc] <outdir> <virtual-name>=<path>...
package tree

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unsafe"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/tspath"
)

var (
	nodePtrType     = reflect.TypeOf((*ast.Node)(nil))
	nodeListType    = reflect.TypeOf((*ast.NodeList)(nil))
	modListType     = reflect.TypeOf((*ast.ModifierList)(nil))
	kindType        = reflect.TypeOf(ast.KindUnknown)
	tokenFlagsType  = reflect.TypeOf(ast.TokenFlagsNone)
	nodeSliceType   = reflect.TypeOf([]*ast.Node(nil))
	stringSliceType = reflect.TypeOf([]string(nil))
	nodeStructType  = reflect.TypeOf(ast.Node{})
)

type field struct {
	name string
	val  reflect.Value
}

func accessible(v reflect.Value) reflect.Value {
	if v.CanInterface() {
		return v
	}
	if !v.CanAddr() {
		return v
	}
	return reflect.NewAt(v.Type(), unsafe.Pointer(v.UnsafeAddr())).Elem()
}

func collect(v reflect.Value, out *[]field) {
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		sf := t.Field(i)
		fv := accessible(v.Field(i))
		if sf.Anonymous && sf.Type.Kind() == reflect.Struct {
			if sf.Type == nodeStructType || sf.Name == "NodeBase" {
				continue
			}
			collect(fv, out)
			continue
		}
		switch sf.Type {
		case nodePtrType, nodeListType, modListType, kindType, tokenFlagsType, nodeSliceType, stringSliceType:
			*out = append(*out, field{sf.Name, fv})
		default:
			if sf.Type.Kind() == reflect.String || sf.Type.Kind() == reflect.Bool {
				*out = append(*out, field{sf.Name, fv})
			}
		}
	}
}

func dataOf(node *ast.Node) reflect.Value {
	nv := reflect.ValueOf(node).Elem()
	dv := accessible(nv.FieldByName("data"))
	if dv.IsNil() {
		return reflect.Value{}
	}
	e := dv.Elem()
	if e.Kind() == reflect.Ptr {
		e = e.Elem()
	}
	return e
}

type dumper struct {
	w    *bufio.Writer
	file *ast.SourceFile
	seen map[*ast.Node]bool
	nojs bool
}

func (d *dumper) list(label string, pos, end int, nodes []*ast.Node, parent *ast.Node, indent int) {
	fmt.Fprintf(d.w, "%s.%s: list [%d,%d) n=%d\n", strings.Repeat(" ", indent), label, pos, end, len(nodes))
	for _, c := range nodes {
		d.node("-", c, parent, indent+2)
	}
}

func (d *dumper) node(label string, node *ast.Node, parent *ast.Node, indent int) {
	pad := strings.Repeat(" ", indent)
	if node == nil {
		fmt.Fprintf(d.w, "%s%s <nil>\n", pad, label)
		return
	}
	fmt.Fprintf(d.w, "%s%s %s [%d,%d) f=%#x", pad, label, node.Kind.String(), node.Pos(), node.End(), uint32(node.Flags))
	if node.Parent != parent {
		if node.Parent == nil {
			fmt.Fprintf(d.w, " parent=nil")
		} else {
			fmt.Fprintf(d.w, " parent=%s[%d,%d)", node.Parent.Kind.String(), node.Parent.Pos(), node.Parent.End())
		}
	}
	if d.seen[node] {
		fmt.Fprintf(d.w, " SHARED\n")
		return
	}
	d.seen[node] = true
	var fields []field
	if node.Kind != ast.KindSourceFile {
		dv := dataOf(node)
		if dv.IsValid() && dv.Kind() == reflect.Struct {
			collect(dv, &fields)
		}
	}
	sort.SliceStable(fields, func(i, j int) bool { return fields[i].name < fields[j].name })
	for _, f := range fields {
		switch f.val.Type() {
		case kindType:
			fmt.Fprintf(d.w, " %s=%s", f.name, ast.Kind(f.val.Int()).String())
		case tokenFlagsType:
			fmt.Fprintf(d.w, " %s=%#x", f.name, f.val.Int())
		case stringSliceType:
			n := f.val.Len()
			parts := make([]string, n)
			for i := 0; i < n; i++ {
				parts[i] = f.val.Index(i).String()
			}
			fmt.Fprintf(d.w, " %s=%s", f.name, strconv.QuoteToASCII(strings.Join(parts, "")))
		default:
			switch f.val.Kind() {
			case reflect.String:
				fmt.Fprintf(d.w, " %s=%s", f.name, strconv.QuoteToASCII(f.val.String()))
			case reflect.Bool:
				if f.val.Bool() {
					fmt.Fprintf(d.w, " %s", f.name)
				}
			}
		}
	}
	fmt.Fprintf(d.w, "\n")
	if node.Kind == ast.KindSourceFile {
		sf := node.AsSourceFile()
		d.list("Statements", sf.Statements.Pos(), sf.Statements.End(), sf.Statements.Nodes, node, indent+2)
		d.node(".EndOfFileToken:", sf.EndOfFileToken, node, indent+2)
	}
	for _, f := range fields {
		switch f.val.Type() {
		case nodePtrType:
			if !f.val.IsNil() {
				d.node("."+f.name+":", (*ast.Node)(f.val.UnsafePointer()), node, indent+2)
			}
		case nodeListType:
			if !f.val.IsNil() {
				l := (*ast.NodeList)(f.val.UnsafePointer())
				d.list(f.name, l.Pos(), l.End(), l.Nodes, node, indent+2)
			}
		case modListType:
			if !f.val.IsNil() {
				l := (*ast.ModifierList)(f.val.UnsafePointer())
				fmt.Fprintf(d.w, "%s.%s.flags=%#x\n", pad+"  ", f.name, uint32(l.ModifierFlags))
				d.list(f.name, l.Pos(), l.End(), l.Nodes, node, indent+2)
			}
		case nodeSliceType:
			if !f.val.IsNil() {
				n := f.val.Len()
				nodes := make([]*ast.Node, n)
				for i := 0; i < n; i++ {
					nodes[i] = (*ast.Node)(f.val.Index(i).UnsafePointer())
				}
				d.list(f.name+"(raw)", -1, -1, nodes, node, indent+2)
			}
		}
	}
	if !d.nojs && node.Flags&ast.NodeFlagsHasJSDoc != 0 {
		for _, j := range node.JSDoc(d.file) {
			d.node(".jsdoc:", j, node, indent+2)
		}
	}
}

func diag(w *bufio.Writer, label string, ds []*ast.Diagnostic) {
	for _, x := range ds {
		fmt.Fprintf(w, "%s [%d,%d) TS%d cat=%d %s\n", label, x.Pos(), x.End(), x.Code(), int(x.Category()), strconv.QuoteToASCII(x.String()))
		for _, r := range x.RelatedInformation() {
			fmt.Fprintf(w, "%s.related [%d,%d) TS%d cat=%d %s\n", label, r.Pos(), r.End(), r.Code(), int(r.Category()), strconv.QuoteToASCII(r.String()))
		}
	}
}

func ref(n *ast.Node) string {
	if n == nil {
		return "<nil>"
	}
	return fmt.Sprintf("%s[%d,%d)", n.Kind.String(), n.Pos(), n.End())
}

func Main() {
	args := os.Args[1:]
	var opts ast.ExternalModuleIndicatorOptions
	nojs := false
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-force":
			opts.Force = true
		case "-jsx":
			opts.JSX = true
		case "-nojsdoc":
			nojs = true
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
		text := string(b)
		text = strings.TrimPrefix(text, "\ufeff")
		fileName := tspath.NormalizePath("/" + name)
		kind := core.EnsureScriptKindFromFileName(fileName)
		sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName:                       fileName,
			Path:                           tspath.Path(fileName),
			ExternalModuleIndicatorOptions: opts,
		}, text, kind)
		out, err := os.Create(filepath.Join(outdir, strings.ReplaceAll(name, "/", "__")+".tsgo.txt"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		w := bufio.NewWriter(out)
		fmt.Fprintf(w, "file %s scriptKind=%d variant=%d dts=%v textLen=%d\n", fileName, int(sf.ScriptKind), int(sf.LanguageVariant), sf.IsDeclarationFile, len(text))
		fmt.Fprintf(w, "externalModuleIndicator %s\n", ref(sf.ExternalModuleIndicator))
		fmt.Fprintf(w, "commonJSModuleIndicator %s\n", ref(sf.CommonJSModuleIndicator))
		fmt.Fprintf(w, "usesUriStyleNodeCoreModules %d\n", int(sf.UsesUriStyleNodeCoreModules))
		fmt.Fprintf(w, "counts nodes=%d identifiers=%d text=%d reparsedClones=%d\n", sf.NodeCount, sf.IdentifierCount, sf.TextCount, len(sf.ReparsedClones))
		for _, im := range sf.Imports() {
			fmt.Fprintf(w, "import %s %s\n", ref(im), strconv.QuoteToASCII(im.Text()))
		}
		for _, m := range sf.ModuleAugmentations {
			fmt.Fprintf(w, "moduleAugmentation %s\n", ref(m))
		}
		for _, m := range sf.AmbientModuleNames {
			fmt.Fprintf(w, "ambientModuleName %s\n", strconv.QuoteToASCII(m))
		}
		for _, p := range sf.Pragmas {
			keys := make([]string, 0, len(p.Args))
			for k := range p.Args {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			fmt.Fprintf(w, "pragma %s [%d,%d) kind=%d", p.Name, p.Pos(), p.End(), int(p.Kind))
			for _, k := range keys {
				v := p.Args[k]
				fmt.Fprintf(w, " %s=%s[%d,%d)", k, strconv.QuoteToASCII(v.Value), v.Pos(), v.End())
			}
			fmt.Fprintf(w, "\n")
		}
		for _, r := range sf.ReferencedFiles {
			fmt.Fprintf(w, "referencedFile [%d,%d) %s mode=%d preserve=%v\n", r.Pos(), r.End(), strconv.QuoteToASCII(r.FileName), int(r.ResolutionMode), r.Preserve)
		}
		for _, r := range sf.TypeReferenceDirectives {
			fmt.Fprintf(w, "typeReference [%d,%d) %s mode=%d preserve=%v\n", r.Pos(), r.End(), strconv.QuoteToASCII(r.FileName), int(r.ResolutionMode), r.Preserve)
		}
		for _, r := range sf.LibReferenceDirectives {
			fmt.Fprintf(w, "libReference [%d,%d) %s mode=%d preserve=%v\n", r.Pos(), r.End(), strconv.QuoteToASCII(r.FileName), int(r.ResolutionMode), r.Preserve)
		}
		if sf.CheckJsDirective != nil {
			fmt.Fprintf(w, "checkJs enabled=%v [%d,%d)\n", sf.CheckJsDirective.Enabled, sf.CheckJsDirective.Range.Pos(), sf.CheckJsDirective.Range.End())
		}
		for _, c := range sf.CommentDirectives {
			fmt.Fprintf(w, "commentDirective [%d,%d) kind=%d\n", c.Loc.Pos(), c.Loc.End(), int(c.Kind))
		}
		diag(w, "diagnostic", sf.Diagnostics())
		diag(w, "jsDiagnostic", sf.JSDiagnostics())
		d := &dumper{w: w, file: sf, seen: map[*ast.Node]bool{}, nojs: nojs}
		d.node("root", sf.AsNode(), nil, 0)
		diag(w, "jsdocDiagnostic", sf.JSDocDiagnostics())
		w.Flush()
		out.Close()
	}
}
