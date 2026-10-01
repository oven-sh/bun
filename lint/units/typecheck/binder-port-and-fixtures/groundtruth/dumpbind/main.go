// Research probe: prints what typescript-go's binder writes for one file, in a canonical text form.
// usage: dumpbind [-force] [-jsx] [-symbols <dir with .symbols baselines>] <outdir> <virtual-name>=<path>...
package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime/coverage"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/binder"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/diagnostics"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/scanner"
	"github.com/microsoft/typescript-go/internal/tspath"
)

type dumper struct {
	w         *bufio.Writer
	file      *ast.SourceFile
	order     []*ast.Node
	index     map[*ast.Node]int
	symbols   []*ast.Symbol
	symIndex  map[*ast.Symbol]int
	symById   map[ast.SymbolId]*ast.Symbol
	flows     []*ast.FlowNode
	flowIndex map[*ast.FlowNode]int
}

func quote(s string) string {
	var sb strings.Builder
	sb.WriteByte('"')
	for i := 0; i < len(s); i++ {
		b := s[i]
		switch {
		case b == '"' || b == '\\':
			sb.WriteByte('\\')
			sb.WriteByte(b)
		case b >= 0x20 && b < 0x7F:
			sb.WriteByte(b)
		default:
			fmt.Fprintf(&sb, "\\x%02X", b)
		}
	}
	sb.WriteByte('"')
	return sb.String()
}

func (d *dumper) nodeRef(n *ast.Node) string {
	if n == nil {
		return "nil"
	}
	if i, ok := d.index[n]; ok {
		return "n" + strconv.Itoa(i)
	}
	return fmt.Sprintf("?%s[%d,%d)", n.Kind.String(), n.Pos(), n.End())
}

func (d *dumper) collectNodes(root *ast.Node) {
	stack := []*ast.Node{root}
	var children []*ast.Node
	add := func(c *ast.Node) bool {
		children = append(children, c)
		return false
	}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if _, ok := d.index[n]; ok {
			continue
		}
		d.index[n] = len(d.order)
		d.order = append(d.order, n)
		children = children[:0]
		n.ForEachChild(add)
		for i := len(children) - 1; i >= 0; i-- {
			stack = append(stack, children[i])
		}
	}
}

// The name of a private member holds the id of the class symbol: print the canonical number of that symbol.
func (d *dumper) canonicalName(name string) string {
	if rest, ok := strings.CutPrefix(name, ast.InternalSymbolNamePrefix+"#"); ok {
		if at := strings.Index(rest, "@"); at > 0 {
			if id, err := strconv.ParseUint(rest[:at], 10, 64); err == nil {
				if s, ok := d.symById[ast.SymbolId(id)]; ok {
					if k, ok := d.symIndex[s]; ok {
						return ast.InternalSymbolNamePrefix + "#<" + strconv.Itoa(k) + ">" + rest[at:]
					}
				}
				return ast.InternalSymbolNamePrefix + "#<?>" + rest[at:]
			}
		}
	}
	return name
}

func sortedKeys(t ast.SymbolTable) []string {
	keys := make([]string, 0, len(t))
	for k := range t {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (d *dumper) visitSymbol(root *ast.Symbol) {
	stack := []*ast.Symbol{root}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if s == nil {
			continue
		}
		if _, ok := d.symIndex[s]; ok {
			continue
		}
		d.symIndex[s] = len(d.symbols) + 1
		d.symbols = append(d.symbols, s)
		var next []*ast.Symbol
		for _, k := range sortedKeys(s.Members) {
			next = append(next, s.Members[k])
		}
		for _, k := range sortedKeys(s.Exports) {
			next = append(next, s.Exports[k])
		}
		next = append(next, s.Parent, s.ExportSymbol)
		for i := len(next) - 1; i >= 0; i-- {
			stack = append(stack, next[i])
		}
	}
}

func (d *dumper) visitFlow(root *ast.FlowNode) {
	stack := []*ast.FlowNode{root}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if f == nil {
			continue
		}
		if _, ok := d.flowIndex[f]; ok {
			continue
		}
		d.flowIndex[f] = len(d.flows) + 1
		d.flows = append(d.flows, f)
		var next []*ast.FlowNode
		if f.Flags&ast.FlowFlagsReduceLabel != 0 && f.Node != nil {
			data := f.Node.AsFlowReduceLabelData()
			next = append(next, data.Target)
			for l := data.Antecedents; l != nil; l = l.Next {
				next = append(next, l.Flow)
			}
		}
		next = append(next, f.Antecedent)
		for l := f.Antecedents; l != nil; l = l.Next {
			next = append(next, l.Flow)
		}
		for i := len(next) - 1; i >= 0; i-- {
			stack = append(stack, next[i])
		}
	}
}

func returnFlowNode(n *ast.Node) *ast.FlowNode {
	switch n.Kind {
	case ast.KindConstructor:
		return n.AsConstructorDeclaration().ReturnFlowNode
	case ast.KindFunctionDeclaration:
		return n.AsFunctionDeclaration().ReturnFlowNode
	case ast.KindFunctionExpression:
		return n.AsFunctionExpression().ReturnFlowNode
	case ast.KindClassStaticBlockDeclaration:
		return n.AsClassStaticBlockDeclaration().ReturnFlowNode
	}
	return nil
}

func fallthroughFlowNode(n *ast.Node) *ast.FlowNode {
	if n.Kind == ast.KindCaseClause || n.Kind == ast.KindDefaultClause {
		return n.AsCaseOrDefaultClause().FallthroughFlowNode
	}
	return nil
}

func (d *dumper) symRef(s *ast.Symbol) string {
	if s == nil {
		return "nil"
	}
	return "#" + strconv.Itoa(d.symIndex[s])
}

func (d *dumper) flowRef(f *ast.FlowNode) string {
	if f == nil {
		return "nil"
	}
	return "f" + strconv.Itoa(d.flowIndex[f])
}

func (d *dumper) table(t ast.SymbolTable) string {
	type entry struct {
		key string
		ref string
	}
	entries := make([]entry, 0, len(t))
	for k, s := range t {
		entries = append(entries, entry{quote(d.canonicalName(k)), d.symRef(s)})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].key < entries[j].key })
	parts := make([]string, len(entries))
	for i, e := range entries {
		parts[i] = e.key + ":" + e.ref
	}
	return "{" + strings.Join(parts, " ") + "}"
}

func (d *dumper) flowList(l *ast.FlowList) string {
	var parts []string
	for ; l != nil; l = l.Next {
		parts = append(parts, d.flowRef(l.Flow))
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func (d *dumper) run() {
	sf := d.file
	root := sf.AsNode()
	d.collectNodes(root)
	// Symbols and flow nodes are numbered in the order in which this walk meets them.
	d.visitSymbol(sf.Symbol)
	for _, k := range sortedKeys(sf.GlobalExports) {
		d.visitSymbol(sf.GlobalExports[k])
	}
	for _, p := range sf.PatternAmbientModules {
		d.visitSymbol(p.Symbol)
	}
	for _, n := range d.order {
		if data := n.DeclarationData(); data != nil {
			d.visitSymbol(data.Symbol)
		}
		if data := n.ExportableData(); data != nil {
			d.visitSymbol(data.LocalSymbol)
		}
		if data := n.LocalsContainerData(); data != nil {
			for _, k := range sortedKeys(data.Locals) {
				d.visitSymbol(data.Locals[k])
			}
		}
		if data := n.FlowNodeData(); data != nil {
			d.visitFlow(data.FlowNode)
		}
		if data := n.BodyData(); data != nil {
			d.visitFlow(data.EndFlowNode)
		}
		d.visitFlow(returnFlowNode(n))
		d.visitFlow(fallthroughFlowNode(n))
	}
	for _, s := range d.symbols {
		d.symById[ast.GetSymbolId(s)] = s
	}
	w := d.w
	fmt.Fprintf(w, "bind-dump v1\n")
	external := "nil"
	if sf.ExternalModuleIndicator != nil {
		external = d.nodeRef(sf.ExternalModuleIndicator)
	}
	fmt.Fprintf(w, "file %s scriptKind=%d dts=%v external=%s commonjs=%s useStrict=%s symbolCount=%d nodes=%d symbols=%d flows=%d\n",
		sf.FileName(), int(sf.ScriptKind), sf.IsDeclarationFile, external, d.nodeRef(sf.CommonJSModuleIndicator), d.nodeRef(binder.FindUseStrictPrologue(sf, sf.Statements.Nodes)), sf.SymbolCount, len(d.order), len(d.symbols), len(d.flows))
	for _, k := range sortedKeys(sf.GlobalExports) {
		fmt.Fprintf(w, "globalExport %s %s\n", quote(k), d.symRef(sf.GlobalExports[k]))
	}
	for _, p := range sf.PatternAmbientModules {
		fmt.Fprintf(w, "patternAmbientModule %s star=%d %s\n", quote(p.Pattern.Text), p.Pattern.StarIndex, d.symRef(p.Symbol))
	}
	for _, x := range sf.BindDiagnostics() {
		fmt.Fprintf(w, "bindDiagnostic [%d,%d) TS%d cat=%d %s\n", x.Pos(), x.End(), x.Code(), int(x.Category()), quote(x.String()))
		for _, r := range x.RelatedInformation() {
			fmt.Fprintf(w, "bindDiagnostic.related [%d,%d) TS%d cat=%d %s\n", r.Pos(), r.End(), r.Code(), int(r.Category()), quote(r.String()))
		}
	}
	fmt.Fprintf(w, "== nodes\n")
	for i, n := range d.order {
		fmt.Fprintf(w, "n%d %s [%d,%d) f=%#x", i, n.Kind.String(), n.Pos(), n.End(), uint32(n.Flags))
		if n.Parent != nil {
			fmt.Fprintf(w, " parent=%s", d.nodeRef(n.Parent))
		}
		if n.Kind != ast.KindSourceFile {
			if name := n.Name(); name != nil {
				fmt.Fprintf(w, " name=%s", d.nodeRef(name))
			}
		}
		if data := n.DeclarationData(); data != nil && data.Symbol != nil {
			fmt.Fprintf(w, " sym=%s", d.symRef(data.Symbol))
		}
		if data := n.ExportableData(); data != nil && data.LocalSymbol != nil {
			fmt.Fprintf(w, " localSym=%s", d.symRef(data.LocalSymbol))
		}
		if data := n.LocalsContainerData(); data != nil {
			if data.Locals != nil {
				fmt.Fprintf(w, " locals=%s", d.table(data.Locals))
			}
			if data.NextContainer != nil {
				fmt.Fprintf(w, " next=%s", d.nodeRef(data.NextContainer))
			}
		}
		if data := n.FlowNodeData(); data != nil && data.FlowNode != nil {
			fmt.Fprintf(w, " flow=%s", d.flowRef(data.FlowNode))
		}
		if data := n.BodyData(); data != nil && data.EndFlowNode != nil {
			fmt.Fprintf(w, " endFlow=%s", d.flowRef(data.EndFlowNode))
		}
		if f := returnFlowNode(n); f != nil {
			fmt.Fprintf(w, " returnFlow=%s", d.flowRef(f))
		}
		if f := fallthroughFlowNode(n); f != nil {
			fmt.Fprintf(w, " fallthroughFlow=%s", d.flowRef(f))
		}
		fmt.Fprintf(w, "\n")
	}
	fmt.Fprintf(w, "== symbols\n")
	for i, s := range d.symbols {
		fmt.Fprintf(w, "#%d %s f=%#x", i+1, quote(d.canonicalName(s.Name)), uint32(s.Flags))
		if s.Parent != nil {
			fmt.Fprintf(w, " parent=%s", d.symRef(s.Parent))
		}
		if s.ExportSymbol != nil {
			fmt.Fprintf(w, " export=%s", d.symRef(s.ExportSymbol))
		}
		if s.ValueDeclaration != nil {
			fmt.Fprintf(w, " value=%s", d.nodeRef(s.ValueDeclaration))
		}
		decls := make([]string, len(s.Declarations))
		for j, decl := range s.Declarations {
			decls[j] = d.nodeRef(decl)
		}
		fmt.Fprintf(w, " decls=[%s]", strings.Join(decls, " "))
		if s.Members != nil {
			fmt.Fprintf(w, " members=%s", d.table(s.Members))
		}
		if s.Exports != nil {
			fmt.Fprintf(w, " exports=%s", d.table(s.Exports))
		}
		fmt.Fprintf(w, "\n")
	}
	fmt.Fprintf(w, "== flow\n")
	for i, f := range d.flows {
		fmt.Fprintf(w, "f%d f=%#x", i+1, uint32(f.Flags))
		switch {
		case f.Flags&ast.FlowFlagsSwitchClause != 0 && f.Node != nil:
			data := f.Node.AsFlowSwitchClauseData()
			fmt.Fprintf(w, " switch=%s start=%d end=%d", d.nodeRef(data.SwitchStatement), data.ClauseStart, data.ClauseEnd)
		case f.Flags&ast.FlowFlagsReduceLabel != 0 && f.Node != nil:
			data := f.Node.AsFlowReduceLabelData()
			fmt.Fprintf(w, " target=%s reduced=%s", d.flowRef(data.Target), d.flowList(data.Antecedents))
		case f.Node != nil:
			fmt.Fprintf(w, " node=%s", d.nodeRef(f.Node))
		}
		if f.Antecedent != nil {
			fmt.Fprintf(w, " antecedent=%s", d.flowRef(f.Antecedent))
		}
		if f.Antecedents != nil {
			fmt.Fprintf(w, " antecedents=%s", d.flowList(f.Antecedents))
		}
		fmt.Fprintf(w, "\n")
	}
	d.resolveSections()
}

func (d *dumper) argRefs(args []any) string {
	parts := make([]string, len(args))
	for i, a := range args {
		parts[i] = quote(fmt.Sprint(a))
	}
	return strings.Join(parts, ",")
}

// Calls the name resolver and the reference resolver with their default hooks on every identifier.
func (d *dumper) resolveSections() {
	w := d.w
	options := &core.CompilerOptions{}
	var events []string
	var arguments *ast.Symbol
	symRef := func(s *ast.Symbol) string {
		if s == nil {
			return "nil"
		}
		if _, ok := d.symIndex[s]; ok {
			return d.symRef(s)
		}
		if s == arguments {
			return "arguments"
		}
		return "?" + quote(s.Name)
	}
	resolver := &binder.NameResolver{
		CompilerOptions: options,
		Error: func(location *ast.Node, message *diagnostics.Message, args ...any) *ast.Diagnostic {
			events = append(events, fmt.Sprintf("error(%s,TS%d,[%s])", d.nodeRef(location), message.Code(), d.argRefs(args)))
			return nil
		},
		SymbolReferenced: func(symbol *ast.Symbol, meaning ast.SymbolFlags) {
			events = append(events, fmt.Sprintf("referenced(%s,%#x)", symRef(symbol), uint32(meaning)))
		},
		OnPropertyWithInvalidInitializer: func(location *ast.Node, name string, declaration *ast.Node, result *ast.Symbol) bool {
			events = append(events, fmt.Sprintf("invalidInitializer(%s,%s,%s)", d.nodeRef(location), d.nodeRef(declaration), symRef(result)))
			return false
		},
		OnFailedToResolveSymbol: func(location *ast.Node, name string, meaning ast.SymbolFlags, message *diagnostics.Message) {
			events = append(events, "failed")
		},
		OnSuccessfullyResolvedSymbol: func(location *ast.Node, result *ast.Symbol, meaning ast.SymbolFlags, lastLocation *ast.Node, associated *ast.Node, deferred bool) {
			events = append(events, fmt.Sprintf("resolved(last=%s,associated=%s,deferred=%v)", d.nodeRef(lastLocation), d.nodeRef(associated), deferred))
		},
	}
	meanings := []struct {
		label string
		flags ast.SymbolFlags
	}{
		{"value", ast.SymbolFlagsValue | ast.SymbolFlagsExportValue},
		{"type", ast.SymbolFlagsType},
		{"namespace", ast.SymbolFlagsNamespace},
	}
	fmt.Fprintf(w, "== resolve\n")
	for i, n := range d.order {
		if n.Kind != ast.KindIdentifier {
			continue
		}
		for _, m := range meanings {
			events = events[:0]
			result := resolver.Resolve(n, n.Text(), m.flags, diagnostics.Cannot_find_name_0, true /*isUse*/, false /*excludeGlobals*/)
			arguments = resolver.ArgumentsSymbol
			if result == nil && len(events) == 1 && events[0] == "failed" {
				continue
			}
			fmt.Fprintf(w, "n%d %s %s %s\n", i, m.label, symRef(result), strings.Join(events, " "))
		}
	}
	fmt.Fprintf(w, "== reference\n")
	references := binder.NewReferenceResolver(options, binder.ReferenceResolverHooks{})
	for i, n := range d.order {
		switch n.Kind {
		case ast.KindIdentifier:
			var parts []string
			if c := references.GetReferencedExportContainer(n, false /*prefixLocals*/); c != nil {
				parts = append(parts, "container="+d.nodeRef(c))
			}
			if c := references.GetReferencedExportContainer(n, true /*prefixLocals*/); c != nil {
				parts = append(parts, "containerPrefixed="+d.nodeRef(c))
			}
			if c := references.GetReferencedImportDeclaration(n); c != nil {
				parts = append(parts, "import="+d.nodeRef(c))
			}
			if c := references.GetReferencedValueDeclaration(n); c != nil {
				parts = append(parts, "value="+d.nodeRef(c))
			}
			if list := references.GetReferencedValueDeclarations(n); len(list) != 0 {
				refs := make([]string, len(list))
				for j, c := range list {
					refs[j] = d.nodeRef(c)
				}
				parts = append(parts, "values=["+strings.Join(refs, " ")+"]")
			}
			if len(parts) != 0 {
				fmt.Fprintf(w, "n%d %s\n", i, strings.Join(parts, " "))
			}
		case ast.KindElementAccessExpression:
			if name := references.GetElementAccessExpressionName(n.AsElementAccessExpression()); name != "" {
				fmt.Fprintf(w, "n%d elementName=%s\n", i, quote(name))
			}
		default:
			if n.Symbol() != nil {
				if c := references.GetReferencedMemberValueDeclaration(n); c != nil && c != n {
					fmt.Fprintf(w, "n%d member=%s\n", i, d.nodeRef(c))
				}
			}
		}
	}
}

var (
	codeLinesRegexp = regexp.MustCompile("[\r\u2028\u2029]|\r?\n")
	lineDelimiter   = regexp.MustCompile("\r?\n")
	declRegexp      = regexp.MustCompile(`Decl\(([^,()]+), (--|\d+), (--|\d+)\)`)
	tsExtension     = regexp.MustCompile(`\.tsx?$`)
)

type baselineLine struct {
	line   int
	text   string
	symbol string
	used   bool
}

func parseSymbolsBaseline(content string, unit string, source string) ([]*baselineLine, bool) {
	marker := "=== " + unit + " ===\r\n"
	at := strings.Index(content, marker)
	if at < 0 {
		return nil, false
	}
	body := content[at+len(marker):]
	if next := strings.Index(body, "\r\n=== "); next >= 0 {
		body = body[:next]
	}
	codeLines := codeLinesRegexp.Split(source, -1)
	var out []*baselineLine
	src := 0
	for _, l := range strings.Split(body, "\r\n") {
		if src < len(codeLines) && l == codeLines[src] {
			src++
			continue
		}
		if strings.HasPrefix(l, ">") {
			if sep := strings.Index(l, " : Symbol("); sep >= 0 {
				out = append(out, &baselineLine{line: src - 1, text: l[1:sep], symbol: l[sep+3:]})
				continue
			}
		}
		if l == "" {
			continue
		}
		return out, false
	}
	return out, true
}

type stats struct {
	files, filesNoBaseline, filesUnparsed int
	names, matched, missing               int
	declMismatch, nameMismatch, merged    int
	declNotName, nameNotDecl              int
	skippedWith, skippedComputed          int
	ambiguous, nameUnchecked              int
	examples                              map[string][]string
}

func (s *stats) example(kind string, text string) {
	if len(s.examples[kind]) < 12 {
		s.examples[kind] = append(s.examples[kind], text)
	}
}

func (d *dumper) checkSymbols(st *stats, unit string, baselinePath string, source string) {
	st.files++
	raw, err := os.ReadFile(baselinePath)
	if err != nil {
		st.filesNoBaseline++
		return
	}
	lines, ok := parseSymbolsBaseline(string(raw), unit, source)
	if !ok {
		st.filesUnparsed++
		st.example("unparsed", baselinePath)
		return
	}
	sf := d.file
	base := tspath.GetBaseFileName(sf.FileName())
	for _, n := range d.order {
		if n.Kind == ast.KindSourceFile || n.Flags&ast.NodeFlagsReparsed != 0 {
			continue
		}
		isName := ast.IsDeclarationName(n)
		parent := n.Parent
		viaDump := false
		if parent != nil && parent.Kind != ast.KindSourceFile {
			if data := parent.DeclarationData(); data != nil && data.Symbol != nil && parent.Name() == n && !ast.IsBindingPattern(n) {
				viaDump = true
			}
		}
		if isName && !viaDump && parent.DeclarationData() != nil && parent.DeclarationData().Symbol != nil {
			st.nameNotDecl++
			st.example("nameNotDecl", fmt.Sprintf("%s %s in %s", unit, n.Kind.String(), parent.Kind.String()))
		}
		if viaDump && !isName {
			st.declNotName++
			st.example("declNotName", fmt.Sprintf("%s %s in %s", unit, n.Kind.String(), parent.Kind.String()))
		}
		if !viaDump {
			continue
		}
		if ast.IsImportOrExportSpecifier(parent) && parent.PropertyName() == n {
			continue
		}
		if n.Flags&ast.NodeFlagsInWithStatement != 0 {
			st.skippedWith++
			continue
		}
		symbol := parent.DeclarationData().Symbol
		if symbol.Name == ast.InternalSymbolNameComputed {
			st.skippedComputed++
			continue
		}
		st.names++
		pos := scanner.SkipTrivia(sf.Text(), n.Pos())
		line := scanner.GetECMALineOfPosition(sf, pos)
		text := lineDelimiter.ReplaceAllString(scanner.GetSourceTextOfNodeFromSourceFile(sf, n, false), "")
		var expected []string
		for i, decl := range symbol.Declarations {
			if i >= 5 {
				break
			}
			l, c := scanner.GetECMALineAndUTF16CharacterOfPosition(sf, decl.Pos())
			expected = append(expected, fmt.Sprintf("Decl(%s, %d, %d)", base, l, int(c)))
		}
		more := ""
		if len(symbol.Declarations) > 5 {
			more = fmt.Sprintf(" ... and %d more", len(symbol.Declarations)-5)
		}
		found := -1
		sameSpot := 0
		distinct := map[string]bool{}
		lastGot := ""
		for i := range lines {
			if lines[i].line != line || lines[i].text != text {
				continue
			}
			sameSpot++
			distinct[lines[i].symbol] = true
			lastGot = lines[i].symbol
			if found >= 0 || lines[i].used {
				continue
			}
			got := lines[i].symbol
			var gotDecls []string
			foreign := false
			for _, m := range declRegexp.FindAllStringSubmatch(got, -1) {
				if m[1] != base || m[2] == "--" {
					foreign = true
					continue
				}
				gotDecls = append(gotDecls, m[0])
			}
			want := expected
			same := len(gotDecls) == len(want)
			if foreign && len(gotDecls) < len(want) {
				// A merged symbol prints five declarations in all: compare the ones of this file that were printed.
				same = true
				want = want[:len(gotDecls)]
			}
			if same {
				for j := range want {
					if want[j] != gotDecls[j] {
						same = false
					}
				}
			}
			if same && !foreign && !strings.HasSuffix(got, more+")") {
				same = false
			}
			if same {
				found = i
				if foreign {
					st.merged++
				}
			}
		}
		if sameSpot == 0 {
			st.missing++
			st.example("missing", fmt.Sprintf("%s:%d %q parent=%s sym=%q", unit, line, text, parent.Kind.String(), symbol.Name))
			continue
		}
		if found < 0 {
			st.declMismatch++
			st.example("declMismatch", fmt.Sprintf("%s:%d %q parent=%s want %v%s got %s", unit, line, text, parent.Kind.String(), expected, more, lastGot))
			continue
		}
		if len(distinct) > 1 {
			st.ambiguous++
		}
		lines[found].used = true
		got := lines[found].symbol
		display := got[len("Symbol("):]
		if c := strings.Index(display, ", Decl("); c >= 0 {
			display = display[:c]
		} else {
			display = strings.TrimSuffix(display, ")")
		}
		own := symbol.Name
		plain := own != "" && own != "default" && own != ast.InternalSymbolNameExportEquals && !strings.HasPrefix(own, ast.InternalSymbolNamePrefix) && scanner.IsValidIdentifier(own)
		if plain {
			first := ast.GetNameOfDeclaration(symbol.Declarations[0])
			plain = first != nil && ast.IsIdentifier(first) && scanner.GetSourceTextOfNodeFromSourceFile(sf, first, false) == own
		}
		if !plain {
			st.nameUnchecked++
		} else if display != own && !strings.HasSuffix(display, "."+own) {
			st.nameMismatch++
			st.example("nameMismatch", fmt.Sprintf("%s:%d %q parent=%s sym=%q display=%q", unit, line, text, parent.Kind.String(), symbol.Name, display))
			continue
		}
		st.matched++
	}
}

var perUnit bool

var (
	coverDir    string
	coverCount  int
	harness     bool
	optionRegex = regexp.MustCompile(`^\/{2}\s*@(\w+)\s*:\s*([^\r\n]*)`)
)

// The content of the only unit of a single-file case, as the test harness of the reference makes it.
func unitContent(code string) string {
	var sb strings.Builder
	for _, line := range lineDelimiter.Split(code, -1) {
		if optionRegex.MatchString(line) {
			continue
		}
		if sb.Len() != 0 {
			sb.WriteByte('\n')
		}
		sb.WriteString(line)
	}
	return sb.String()
}

func main() {
	args := os.Args[1:]
	var opts ast.ExternalModuleIndicatorOptions
	symbolsDir := ""
	for len(args) > 0 && args[0] != "-" && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-force":
			opts.Force = true
		case "-jsx":
			opts.JSX = true
		case "-harness":
			harness = true
		case "-perunit":
			perUnit = true
		case "-cover":
			coverDir = args[1]
			args = args[1:]
		case "-symbols":
			symbolsDir = args[1]
			args = args[1:]
		}
		args = args[1:]
	}
	outdir := args[0]
	st := &stats{examples: map[string][]string{}}
	for _, a := range args[1:] {
		if strings.HasPrefix(a, "@") {
			list, err := os.ReadFile(a[1:])
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			for _, l := range strings.Split(string(list), "\n") {
				if l != "" {
					one(outdir, symbolsDir, opts, st, l)
				}
			}
			continue
		}
		one(outdir, symbolsDir, opts, st, a)
	}
	if st.files != 0 {
		fmt.Printf("files=%d noBaseline=%d unparsed=%d names=%d matched=%d missing=%d declMismatch=%d nameMismatch=%d merged=%d declNotName=%d nameNotDecl=%d skippedWith=%d skippedComputed=%d ambiguous=%d nameUnchecked=%d\n",
			st.files, st.filesNoBaseline, st.filesUnparsed, st.names, st.matched, st.missing, st.declMismatch, st.nameMismatch, st.merged, st.declNotName, st.nameNotDecl, st.skippedWith, st.skippedComputed, st.ambiguous, st.nameUnchecked)
		kinds := make([]string, 0, len(st.examples))
		for k := range st.examples {
			kinds = append(kinds, k)
		}
		sort.Strings(kinds)
		for _, k := range kinds {
			for _, e := range st.examples[k] {
				fmt.Printf("  %s: %s\n", k, e)
			}
		}
	}
}

func one(outdir string, symbolsDir string, opts ast.ExternalModuleIndicatorOptions, st *stats, a string) {
	fields := strings.Split(a, "=")
	name, path := fields[0], fields[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	text := strings.TrimPrefix(string(b), "\ufeff")
	if harness {
		text = unitContent(text)
	}
	fileName := tspath.NormalizePath("/" + name)
	kind := core.EnsureScriptKindFromFileName(fileName)
	sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName:                       fileName,
		Path:                           tspath.Path(fileName),
		ExternalModuleIndicatorOptions: opts,
	}, text, kind)
	if coverDir != "" {
		if err := coverage.ClearCounters(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	failed := ""
	func() {
		defer func() {
			if r := recover(); r != nil {
				failed = fmt.Sprint(r)
			}
		}()
		binder.BindSourceFile(sf)
	}()
	d := &dumper{
		file:      sf,
		index:     map[*ast.Node]int{},
		symIndex:  map[*ast.Symbol]int{},
		symById:   map[ast.SymbolId]*ast.Symbol{},
		flowIndex: map[*ast.FlowNode]int{},
	}
	if outdir != "-" {
		out, err := os.Create(filepath.Join(outdir, strings.ReplaceAll(name, "/", "__")+".bind.txt"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		d.w = bufio.NewWriter(out)
		if failed != "" {
			fmt.Fprintf(d.w, "bind-dump v1\npanic %s\n", quote(failed))
		} else {
			d.run()
		}
		d.w.Flush()
		out.Close()
	} else if failed == "" {
		d.w = bufio.NewWriter(discard{})
		d.run()
	}
	if coverDir != "" {
		dir := filepath.Join(coverDir, strconv.Itoa(coverCount))
		coverCount++
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "name.txt"), []byte(name+"\n"), 0o644)
		if err := coverage.WriteCountersDir(dir); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if coverCount == 1 {
			if err := coverage.WriteMetaDir(coverDir); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
		}
	}
	if failed != "" {
		fmt.Printf("PANIC %s: %s\n", name, failed)
		return
	}
	if len(fields) == 4 {
		before := *st
		d.checkSymbols(st, fields[3], fields[2], text)
		if perUnit {
			fmt.Printf("UNIT\t%s\t%d\t%d\t%d\n", name, st.names-before.names, (st.missing+st.declMismatch+st.nameMismatch)-(before.missing+before.declMismatch+before.nameMismatch), st.filesUnparsed-before.filesUnparsed)
		}
	} else if symbolsDir != "" {
		baseName := tspath.GetBaseFileName(fileName)
		stem := tsExtension.ReplaceAllString(baseName, "")
		d.checkSymbols(st, baseName, filepath.Join(symbolsDir, stem+".symbols"), text)
	}
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
