// Research probe: the state of typescript-go's checker as structure, with no printed type text.
// Every type, every signature and every symbol that the checker created is printed in creation order with every field
// that is set, then the entries of the link stores and the diagnostics as codes and spans. References are ids, so a
// port that numbers its types, signatures and created symbols in creation order prints the same text from its arenas.
// usage: types [-strict|-nostrict] [-exact] [-checkjs] [-o key=value]... [-stage <stage>]... [-from N] [-nolinks] [-schema] <virtual-name>=<path>...
// Files whose virtual name starts with lib. are library files: they are bound and merged, and no stage walks them.
// Stages run in the order given, each over the other files in argument order and inside a file in tree order:
//
//	declared   GetDeclaredTypeOfSymbol of every class, interface, type alias, enum and type parameter declaration
//	typenodes  GetTypeFromTypeNode of every type node whose parent is not a type node
//	typeof     GetTypeOfSymbol of every declaration whose symbol has a value meaning
//	members    properties, signatures, index infos, base types, apparent type and base constraint of every type made so
//	           far; it prints a count, the results are in the records
//	returns    GetReturnTypeOfSignature of every signature made so far (a count too)
//	relate     IsTypeAssignableTo for every ordered pair of the top level variables of the last file
//	check      GetDiagnostics of every file
//
// -from N prints only the types with id >= N (the types that NewChecker makes come first). -schema prints the field
// tables instead of running: one line per struct with its fields in print order.
// The creation numbers of the reference change from run to run: pipe the output through the canon sub-command.
package types

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"unsafe"

	"github.com/microsoft/typescript-go/cmd/oracle/decl"
	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/checker"
	"github.com/microsoft/typescript-go/internal/core"
)

type nodeLike interface{ AsNode() *ast.Node }

var (
	tType     = reflect.TypeOf((*checker.Type)(nil))
	tSig      = reflect.TypeOf((*checker.Signature)(nil))
	tSym      = reflect.TypeOf((*ast.Symbol)(nil))
	tNode     = reflect.TypeOf((*ast.Node)(nil))
	tFile     = reflect.TypeOf((*ast.SourceFile)(nil))
	tMapper   = reflect.TypeOf((*checker.TypeMapper)(nil))
	tNodeLike = reflect.TypeOf((*nodeLike)(nil)).Elem()
	tAtomic   = reflect.TypeOf(atomic.Uint64{})
)

// Structs that are printed inline when a field points to one. Any other struct pointer is printed as &Name.
var inline = map[string]bool{
	"IndexInfo": true, "TypeAlias": true, "TypePredicate": true, "ConditionalRoot": true, "CompositeSignature": true,
	"TupleElementInfo": true,
}

// Embedded structs that only lead back to the owner.
var skipEmbedded = map[string]bool{"Type": true, "TypeBase": true, "TypeMapper": true, "TypeMapperBase": true}

type dumper struct {
	w        *bufio.Writer
	c        *checker.Checker
	files    []*ast.SourceFile
	multi    bool
	symIndex map[*ast.Symbol]int
}

func open(v reflect.Value) reflect.Value {
	if v.CanInterface() || !v.CanAddr() {
		return v
	}
	return reflect.NewAt(v.Type(), unsafe.Pointer(v.UnsafeAddr())).Elem()
}

func (d *dumper) fileTag(n *ast.Node) string {
	if !d.multi {
		return ""
	}
	for p := n; p != nil; p = p.Parent {
		if p.Kind == ast.KindSourceFile {
			return "@" + strings.TrimPrefix(p.AsSourceFile().FileName(), "/")
		}
	}
	return "@?"
}

func (d *dumper) nodeRef(n *ast.Node) string {
	if n == nil {
		return ""
	}
	if n.Pos() < 0 {
		return strings.TrimPrefix(n.Kind.String(), "Kind") + "[synthetic]"
	}
	return fmt.Sprintf("%s[%d,%d)%s", strings.TrimPrefix(n.Kind.String(), "Kind"), n.Pos(), n.End(), d.fileTag(n))
}

func name(s string) string {
	return strconv.QuoteToASCII(s)
}

// A created symbol is Y<creation index>. A symbol of the binder is $<name>/<flags>@<first declaration>.
func (d *dumper) symRef(s *ast.Symbol) string {
	if s == nil {
		return ""
	}
	if i, ok := d.symIndex[s]; ok {
		return "Y" + strconv.Itoa(i)
	}
	where := "-"
	if len(s.Declarations) > 0 {
		where = d.nodeRef(s.Declarations[0])
	}
	return fmt.Sprintf("$%s/%#x@%s", name(s.Name), uint32(s.Flags), where)
}

func typeRef(t *checker.Type) string {
	if t == nil {
		return ""
	}
	return "T" + strconv.FormatUint(uint64(t.Id()), 10)
}

func sigRef(s *checker.Signature) string {
	if s == nil {
		return ""
	}
	return "G" + strconv.FormatUint(uint64(s.Id()), 10)
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func (d *dumper) mapper(m *checker.TypeMapper) string {
	if m == nil {
		return ""
	}
	data := open(reflect.ValueOf(m).Elem().FieldByName("data"))
	if data.IsNil() {
		return "mapper{}"
	}
	p := data.Elem()
	if p.Kind() == reflect.Pointer {
		if p.IsNil() {
			return "mapper{}"
		}
		p = p.Elem()
	}
	return strings.TrimSuffix(p.Type().Name(), "TypeMapper") + "{" + strings.Join(d.fields(p), " ") + "}"
}

func (d *dumper) fields(v reflect.Value) []string {
	var out []string
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		fv := open(v.Field(i))
		if f.Anonymous && f.Type.Kind() == reflect.Struct {
			if !skipEmbedded[f.Type.Name()] {
				out = append(out, d.fields(fv)...)
			}
			continue
		}
		if f.Type == tAtomic || f.Name == "id" || f.Name == "checker" {
			continue
		}
		if s := d.value(fv); s != "" {
			out = append(out, f.Name+"="+s)
		}
	}
	return out
}

func (d *dumper) list(v reflect.Value) string {
	n := v.Len()
	if n == 0 {
		return ""
	}
	parts := make([]string, n)
	for i := 0; i < n; i++ {
		parts[i] = orDash(d.value(open(v.Index(i))))
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func typeIdOf(s string) int {
	n, _ := strconv.Atoi(strings.TrimPrefix(s, "T"))
	return n
}

func (d *dumper) mapValue(v reflect.Value) string {
	n := v.Len()
	if n == 0 {
		return ""
	}
	type entry struct{ k, v string }
	entries := make([]entry, 0, n)
	kt := v.Type().Key()
	if kt == tType || kt == tSig || kt == tSym {
		// The keys have no order that holds from run to run: only the size is printed.
		return "#" + strconv.Itoa(n)
	}
	it := v.MapRange()
	for it.Next() {
		k := ""
		switch {
		case kt.Kind() == reflect.String:
			k = name(it.Key().String())
		case kt == tType || kt == tSym || kt == tNode || kt == tSig:
			k = d.value(it.Key())
		}
		entries = append(entries, entry{k, orDash(d.value(it.Value()))})
	}
	keyed := kt.Kind() == reflect.String || kt == tType || kt == tSym || kt == tNode || kt == tSig
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if keyed {
			if kt == tType {
				return typeIdOf(a.k) < typeIdOf(b.k)
			}
			return a.k < b.k
		}
		if strings.HasPrefix(a.v, "T") && strings.HasPrefix(b.v, "T") {
			return typeIdOf(a.v) < typeIdOf(b.v)
		}
		return a.v < b.v
	})
	parts := make([]string, len(entries))
	for i, e := range entries {
		if keyed {
			parts[i] = e.k + ":" + e.v
		} else {
			parts[i] = e.v
		}
	}
	if keyed {
		return "{" + strings.Join(parts, " ") + "}"
	}
	// A cache keyed by a hash: the keys carry no order, so the values are listed in order.
	return "#" + strconv.Itoa(n) + "[" + strings.Join(parts, ",") + "]"
}

// value returns the printed form of a field, or "" when the field holds its zero value.
func (d *dumper) value(v reflect.Value) string {
	v = open(v)
	switch v.Type() {
	case tType:
		if v.IsNil() {
			return ""
		}
		return typeRef((*checker.Type)(v.UnsafePointer()))
	case tSig:
		if v.IsNil() {
			return ""
		}
		return sigRef((*checker.Signature)(v.UnsafePointer()))
	case tSym:
		if v.IsNil() {
			return ""
		}
		return d.symRef((*ast.Symbol)(v.UnsafePointer()))
	case tNode:
		if v.IsNil() {
			return ""
		}
		return d.nodeRef((*ast.Node)(v.UnsafePointer()))
	case tMapper:
		if v.IsNil() {
			return ""
		}
		return d.mapper((*checker.TypeMapper)(v.UnsafePointer()))
	}
	switch v.Kind() {
	case reflect.Bool:
		if v.Bool() {
			return "true"
		}
		return ""
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if v.Int() == 0 {
			return ""
		}
		return strconv.FormatInt(v.Int(), 10)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if v.Uint() == 0 {
			return ""
		}
		if strings.HasSuffix(v.Type().Name(), "Flags") {
			return "0x" + strconv.FormatUint(v.Uint(), 16)
		}
		return strconv.FormatUint(v.Uint(), 10)
	case reflect.String:
		if v.Len() == 0 {
			return ""
		}
		return name(v.String())
	case reflect.Slice:
		if v.IsNil() {
			return ""
		}
		if v.Type().Elem().Kind() == reflect.String {
			parts := make([]string, v.Len())
			for i := range parts {
				parts[i] = name(v.Index(i).String())
			}
			return "[" + strings.Join(parts, ",") + "]"
		}
		return d.list(v)
	case reflect.Array:
		s := d.list(v)
		if strings.Trim(s, "[-,]") == "" {
			return ""
		}
		return s
	case reflect.Map:
		if v.IsNil() {
			return ""
		}
		return d.mapValue(v)
	case reflect.Func:
		if v.IsNil() {
			return ""
		}
		return "func"
	case reflect.Interface:
		if v.IsNil() {
			return ""
		}
		e := v.Elem()
		switch e.Kind() {
		case reflect.String:
			return name(e.String()) + "(string)"
		case reflect.Pointer, reflect.Struct, reflect.Func, reflect.Map, reflect.Slice, reflect.Interface:
			if e.Kind() == reflect.Struct && e.CanInterface() {
				return fmt.Sprintf("%v(%s)", e.Interface(), e.Type().String())
			}
			return d.value(e)
		}
		if e.CanInterface() {
			return fmt.Sprintf("%v(%s)", e.Interface(), e.Type().String())
		}
		return "?(" + e.Type().String() + ")"
	case reflect.Pointer:
		if v.IsNil() {
			return ""
		}
		if v.Type().Implements(tNodeLike) && v.CanInterface() {
			return d.nodeRef(v.Interface().(nodeLike).AsNode())
		}
		if v.Type() == tFile {
			return "file:" + strings.TrimPrefix((*ast.SourceFile)(v.UnsafePointer()).FileName(), "/")
		}
		e := v.Elem()
		if e.Kind() == reflect.Struct && inline[e.Type().Name()] {
			return "{" + strings.Join(d.fields(e), " ") + "}"
		}
		return "&" + e.Type().Name()
	case reflect.Struct:
		if inline[v.Type().Name()] {
			return "{" + strings.Join(d.fields(v), " ") + "}"
		}
		fs := d.fields(v)
		if len(fs) == 0 {
			return ""
		}
		return "{" + strings.Join(fs, " ") + "}"
	}
	return ""
}

func dataOf(t *checker.Type) reflect.Value {
	data := open(reflect.ValueOf(t).Elem().FieldByName("data"))
	if data.IsNil() {
		return reflect.Value{}
	}
	p := data.Elem()
	if p.Kind() == reflect.Pointer {
		p = p.Elem()
	}
	return p
}

func (d *dumper) typeLine(t *checker.Type) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "T%d %s(%#x)", t.Id(), strings.Join(checker.FormatTypeFlags(t.Flags()), "|"), uint32(t.Flags()))
	if t.ObjectFlags() != 0 {
		fmt.Fprintf(&sb, " of=%#x", uint32(t.ObjectFlags()))
	}
	data := dataOf(t)
	if data.IsValid() {
		sb.WriteString(" " + data.Type().Name())
	}
	if s := t.Symbol(); s != nil {
		sb.WriteString(" symbol=" + d.symRef(s))
	}
	if a := t.Alias(); a != nil {
		sb.WriteString(" alias=" + d.value(reflect.ValueOf(a)))
	}
	if data.IsValid() {
		for _, f := range d.fields(data) {
			sb.WriteString(" " + f)
		}
	}
	return sb.String()
}

func forEachNode(root *ast.Node, visit func(n *ast.Node)) {
	stack := []*ast.Node{root}
	var children []*ast.Node
	add := func(c *ast.Node) bool {
		children = append(children, c)
		return false
	}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		visit(n)
		children = children[:0]
		n.ForEachChild(add)
		for i := len(children) - 1; i >= 0; i-- {
			stack = append(stack, children[i])
		}
	}
}

func isLib(f *ast.SourceFile) bool { return strings.HasPrefix(f.FileName(), "/lib.") }

func symbolOf(n *ast.Node) *ast.Symbol {
	if n.Kind == ast.KindSourceFile {
		return nil
	}
	if data := n.DeclarationData(); data != nil {
		return data.Symbol
	}
	return nil
}

const typeMeaning = ast.SymbolFlagsClass | ast.SymbolFlagsInterface | ast.SymbolFlagsTypeAlias | ast.SymbolFlagsEnum | ast.SymbolFlagsTypeParameter

func (d *dumper) stage(stage string) {
	c := d.c
	w := d.w
	fmt.Fprintf(w, "== stage %s\n", stage)
	switch stage {
	case "declared", "typenodes", "typeof":
		for _, f := range d.files {
			if isLib(f) {
				continue
			}
			forEachNode(f.AsNode(), func(n *ast.Node) {
				switch stage {
				case "declared":
					if s := symbolOf(n); s != nil && s.Flags&typeMeaning != 0 {
						fmt.Fprintf(w, "declared %s = %s\n", d.nodeRef(n), orDash(typeRef(c.GetDeclaredTypeOfSymbol(s))))
					}
				case "typenodes":
					if ast.IsTypeNode(n) && (n.Parent == nil || !ast.IsTypeNode(n.Parent)) {
						fmt.Fprintf(w, "typenode %s = %s\n", d.nodeRef(n), orDash(typeRef(c.GetTypeFromTypeNode(n))))
					}
				case "typeof":
					if s := symbolOf(n); s != nil && s.Flags&ast.SymbolFlagsValue != 0 {
						fmt.Fprintf(w, "typeof %s = %s\n", d.nodeRef(n), orDash(typeRef(c.GetTypeOfSymbol(s))))
					}
				}
			})
		}
	case "members":
		// The list grows while it is walked: the types that a step makes are visited too, up to a fixed bound.
		visited := 0
		for i := 0; i < len(checker.ProbeTypes(c)) && i < 20000; i++ {
			t := checker.ProbeTypes(c)[i]
			if t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsUnion|checker.TypeFlagsIntersection|checker.TypeFlagsTypeParameter|checker.TypeFlagsIndexedAccess|checker.TypeFlagsConditional|checker.TypeFlagsIndex|checker.TypeFlagsSubstitution|checker.TypeFlagsTemplateLiteral|checker.TypeFlagsStringMapping) == 0 {
				continue
			}
			props := c.GetPropertiesOfType(t)
			calls := c.GetSignaturesOfType(t, checker.SignatureKindCall)
			news := c.GetSignaturesOfType(t, checker.SignatureKindConstruct)
			infos := c.GetIndexInfosOfType(t)
			bases := 0
			if t.ObjectFlags()&checker.ObjectFlagsClassOrInterface != 0 {
				bases = len(c.GetBaseTypes(t))
			}
			_, _, _, _, _ = props, calls, news, infos, bases
			_, _ = c.GetApparentType(t), c.GetBaseConstraintOfType(t)
			visited++
		}
		// The walk is in creation order, which changes from run to run: only the count is printed.
		fmt.Fprintf(w, "members types=%d\n", visited)
	case "returns":
		for i := 0; i < len(checker.ProbeSignatures(c)) && i < 20000; i++ {
			s := checker.ProbeSignatures(c)[i]
			_ = c.GetReturnTypeOfSignature(s)
		}
		fmt.Fprintf(w, "returns signatures=%d\n", len(checker.ProbeSignatures(c)))
	case "relate":
		var last *ast.SourceFile
		for _, f := range d.files {
			if !isLib(f) {
				last = f
			}
		}
		if last == nil {
			return
		}
		var names []string
		var types []*checker.Type
		for _, st := range last.Statements.Nodes {
			if st.Kind != ast.KindVariableStatement {
				continue
			}
			for _, vd := range st.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if s := symbolOf(vd); s != nil {
					names = append(names, s.Name)
					types = append(types, c.GetTypeOfSymbol(s))
				}
			}
		}
		for i, s := range types {
			var row strings.Builder
			for _, t := range types {
				if c.IsTypeAssignableTo(s, t) {
					row.WriteByte('1')
				} else {
					row.WriteByte('0')
				}
			}
			fmt.Fprintf(w, "relate %s %s %s\n", name(names[i]), typeRef(s), row.String())
		}
	case "check":
		for _, f := range d.files {
			if isLib(f) {
				continue
			}
			ds := c.GetDiagnostics(context.Background(), f)
			fmt.Fprintf(w, "check %s diagnostics=%d\n", strings.TrimPrefix(f.FileName(), "/"), len(ds))
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown stage %s\n", stage)
		os.Exit(2)
	}
}

func (d *dumper) diag(label string, x *ast.Diagnostic) {
	file := "-"
	if x.File() != nil {
		file = strings.TrimPrefix(x.File().FileName(), "/")
	}
	fmt.Fprintf(d.w, "%s %s [%d,%d) TS%d cat=%d chain=%d related=%d\n", label, file, x.Pos(), x.End(), x.Code(), int(x.Category()), len(x.MessageChain()), len(x.RelatedInformation()))
	for _, m := range x.MessageChain() {
		d.chain(label+".chain", m)
	}
	for _, r := range x.RelatedInformation() {
		d.diag(label+".related", r)
	}
}

func (d *dumper) chain(label string, x *ast.Diagnostic) {
	fmt.Fprintf(d.w, "%s TS%d\n", label, x.Code())
	for _, m := range x.MessageChain() {
		d.chain(label+".chain", m)
	}
}

func loadId(v reflect.Value) uint64 {
	f := open(v.FieldByName("id"))
	if !f.IsValid() || !f.CanAddr() {
		return 0
	}
	return (*atomic.Uint64)(unsafe.Pointer(f.UnsafeAddr())).Load()
}

// Every symbol that the dump can name: the created ones and the ones the binder made for the files.
func (d *dumper) knownSymbols() []*ast.Symbol {
	seen := map[*ast.Symbol]bool{}
	var out []*ast.Symbol
	var add func(s *ast.Symbol)
	add = func(s *ast.Symbol) {
		if s == nil || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
		for _, k := range sortedKeys(s.Members) {
			add(s.Members[k])
		}
		for _, k := range sortedKeys(s.Exports) {
			add(s.Exports[k])
		}
		add(s.Parent)
		add(s.ExportSymbol)
	}
	for _, s := range checker.ProbeSymbols(d.c) {
		add(s)
	}
	for _, f := range d.files {
		add(f.Symbol)
		forEachNode(f.AsNode(), func(n *ast.Node) {
			if n.Kind != ast.KindSourceFile {
				if data := n.DeclarationData(); data != nil {
					add(data.Symbol)
				}
				if data := n.ExportableData(); data != nil {
					add(data.LocalSymbol)
				}
			}
			if data := n.LocalsContainerData(); data != nil {
				for _, k := range sortedKeys(data.Locals) {
					add(data.Locals[k])
				}
			}
		})
	}
	return out
}

func sortedKeys(t ast.SymbolTable) []string {
	keys := make([]string, 0, len(t))
	for k := range t {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// entry prints the value of a link store entry: the set fields of a struct, or the one value of anything else.
func (d *dumper) entry(v reflect.Value) []string {
	if v.Kind() == reflect.Struct {
		return d.fields(v)
	}
	if s := d.value(v); s != "" {
		return []string{s}
	}
	return nil
}

func (d *dumper) links() {
	w := d.w
	cv := reflect.ValueOf(d.c).Elem()
	ct := cv.Type()
	symById := map[uint64]*ast.Symbol{}
	for _, s := range d.knownSymbols() {
		if id := loadId(reflect.ValueOf(s).Elem()); id != 0 {
			symById[id] = s
		}
	}
	nodeById := map[uint64]*ast.Node{}
	for _, f := range d.files {
		forEachNode(f.AsNode(), func(n *ast.Node) {
			if id := loadId(reflect.ValueOf(n).Elem()); id != 0 {
				nodeById[id] = n
			}
		})
	}
	for i := 0; i < ct.NumField(); i++ {
		f := ct.Field(i)
		tn := f.Type.String()
		if !strings.Contains(tn, "LinkStore[") {
			continue
		}
		fv := open(cv.Field(i))
		var lines []string
		if entries := fv.FieldByName("entries"); entries.IsValid() {
			entries = open(entries)
			it := entries.MapRange()
			for it.Next() {
				key := d.value(it.Key())
				if fs := d.entry(it.Value().Elem()); len(fs) > 0 {
					lines = append(lines, orDash(key)+" "+strings.Join(fs, " "))
				}
			}
		} else if store := fv.FieldByName("store"); store.IsValid() {
			store = open(store)
			bySymbol := strings.HasPrefix(tn, "checker.symbolArenaLinkStore")
			page := func(index uint64, p reflect.Value) {
				if p.IsNil() {
					return
				}
				arr := p.Elem()
				for j := 0; j < arr.Len(); j++ {
					e := open(arr.Index(j))
					if e.Kind() == reflect.Pointer {
						if e.IsNil() {
							continue
						}
						e = e.Elem()
					}
					fs := d.entry(e)
					if len(fs) == 0 {
						continue
					}
					id := index<<8 | uint64(j)
					key := "?" + strconv.FormatUint(id, 10)
					if bySymbol {
						if s, ok := symById[id]; ok {
							key = d.symRef(s)
						}
					} else if n, ok := nodeById[id]; ok {
						key = d.nodeRef(n)
					}
					lines = append(lines, key+" "+strings.Join(fs, " "))
				}
			}
			list := open(store.FieldByName("pageList"))
			for j := 0; j < list.Len(); j++ {
				page(uint64(j), open(list.Index(j)))
			}
			m := open(store.FieldByName("pageMap"))
			it := m.MapRange()
			for it.Next() {
				page(it.Key().Uint(), it.Value())
			}
		}
		sort.Strings(lines)
		unknown := 0
		for _, l := range lines {
			if strings.HasPrefix(l, "?") {
				unknown++
				continue
			}
			fmt.Fprintf(w, "L %s %s\n", f.Name, l)
		}
		if unknown > 0 {
			fmt.Fprintf(w, "L %s unnamed=%d\n", f.Name, unknown)
		}
	}
}

func typ[T any]() reflect.Type { return reflect.TypeOf((*T)(nil)).Elem() }

func schemaOf(t reflect.Type, out *[]string) {
	if t.Kind() != reflect.Struct {
		*out = append(*out, strings.ReplaceAll(t.String(), " ", ""))
		return
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if f.Anonymous && f.Type.Kind() == reflect.Struct {
			if !skipEmbedded[f.Type.Name()] {
				schemaOf(f.Type, out)
			}
			continue
		}
		if f.Type == tAtomic || f.Name == "id" || f.Name == "checker" {
			continue
		}
		*out = append(*out, f.Name+":"+strings.ReplaceAll(f.Type.String(), " ", ""))
	}
}

func schema(w *bufio.Writer) {
	all := []reflect.Type{
		typ[checker.IntrinsicType](), typ[checker.LiteralType](), typ[checker.UniqueESSymbolType](), typ[checker.ObjectType](), typ[checker.TypeReference](),
		typ[checker.InterfaceType](), typ[checker.TupleType](), typ[checker.InstantiationExpressionType](), typ[checker.MappedType](), typ[checker.ReverseMappedType](),
		typ[checker.EvolvingArrayType](), typ[checker.UnionType](), typ[checker.IntersectionType](), typ[checker.TypeParameter](), typ[checker.IndexType](),
		typ[checker.IndexedAccessType](), typ[checker.TemplateLiteralType](), typ[checker.StringMappingType](), typ[checker.SubstitutionType](), typ[checker.ConditionalType](),
		typ[checker.Signature](), typ[checker.IndexInfo](), typ[checker.TypeAlias](), typ[checker.TypePredicate](), typ[checker.ConditionalRoot](), typ[checker.CompositeSignature](),
		typ[checker.TupleElementInfo](), typ[checker.SimpleTypeMapper](), typ[checker.ArrayTypeMapper](), typ[checker.ArrayToSingleTypeMapper](), typ[checker.DeferredTypeMapper](),
		typ[checker.FunctionTypeMapper](), typ[checker.MergedTypeMapper](), typ[checker.CompositeTypeMapper](), typ[checker.InferenceTypeMapper](), typ[ast.Symbol](),
	}
	for _, t := range all {
		var fs []string
		schemaOf(t, &fs)
		fmt.Fprintf(w, "struct %s %s\n", t.Name(), strings.Join(fs, " "))
	}
	ct := typ[checker.Checker]()
	for i := 0; i < ct.NumField(); i++ {
		f := ct.Field(i)
		if !strings.Contains(f.Type.String(), "LinkStore[") {
			continue
		}
		vt := f.Type
		var fs []string
		if m, ok := vt.FieldByName("entries"); ok {
			schemaOf(m.Type.Elem().Elem(), &fs)
		} else if s, ok := vt.FieldByName("store"); ok {
			if pl, ok := s.Type.FieldByName("pageList"); ok {
				e := pl.Type.Elem().Elem().Elem()
				if e.Kind() == reflect.Pointer {
					e = e.Elem()
				}
				schemaOf(e, &fs)
			}
		}
		fmt.Fprintf(w, "links %s %s\n", f.Name, strings.Join(fs, " "))
	}
}

func Main() {
	args := os.Args[1:]
	options := &core.CompilerOptions{}
	var stages []string
	from := 1
	links := true
	w := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer w.Flush()
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-strict":
			options.Strict = core.TSTrue
		case "-nostrict":
			options.Strict = core.TSFalse
		case "-exact":
			options.ExactOptionalPropertyTypes = core.TSTrue
		case "-checkjs":
			options.AllowJs = core.TSTrue
			options.CheckJs = core.TSTrue
		case "-nolinks":
			links = false
		case "-schema":
			schema(w)
			return
		case "-o":
			decl.SetOption(options, args[1])
			args = args[1:]
		case "-stage":
			stages = append(stages, args[1])
			args = args[1:]
		case "-from":
			from, _ = strconv.Atoi(args[1])
			args = args[1:]
		}
		args = args[1:]
	}
	p := decl.NewProgram(options, args)
	c, _ := checker.NewChecker(p, nil)
	d := &dumper{w: w, c: c, files: p.Files(), symIndex: map[*ast.Symbol]int{}}
	user := 0
	for _, f := range d.files {
		if !isLib(f) {
			user++
		}
	}
	d.multi = len(d.files) > 1
	fmt.Fprintf(w, "types-dump v1\n")
	for _, m := range checker.ProbeMarks(c) {
		fmt.Fprintf(w, "mark %s\n", m)
	}
	fmt.Fprintf(w, "after NewChecker types=%d symbols=%d signatures=%d\n", c.TypeCount, c.SymbolCount, c.SignatureCount)
	index := func() {
		for i, s := range checker.ProbeSymbols(c) {
			d.symIndex[s] = i + 1
		}
	}
	index()
	for _, st := range stages {
		d.stage(st)
		index()
	}
	// The fields of the checker that hold a type, a signature or a symbol, in struct order: which record is anyType, and so on.
	fmt.Fprintf(w, "== fields\n")
	cv := reflect.ValueOf(c).Elem()
	ct := cv.Type()
	for i := 0; i < ct.NumField(); i++ {
		f := ct.Field(i)
		if f.Type != tType && f.Type != tSig && f.Type != tSym {
			continue
		}
		if s := d.value(cv.Field(i)); s != "" {
			fmt.Fprintf(w, "F %s %s\n", f.Name, s)
		}
	}
	fmt.Fprintf(w, "== counts types=%d symbols=%d signatures=%d files=%d\n", c.TypeCount, c.SymbolCount, c.SignatureCount, user)
	fmt.Fprintf(w, "== types\n")
	for _, t := range checker.ProbeTypes(c) {
		if int(t.Id()) >= from {
			fmt.Fprintf(w, "%s\n", d.typeLine(t))
		}
	}
	fmt.Fprintf(w, "== signatures\n")
	for _, s := range checker.ProbeSignatures(c) {
		fmt.Fprintf(w, "G%d %s\n", s.Id(), strings.Join(d.fields(reflect.ValueOf(s).Elem()), " "))
	}
	fmt.Fprintf(w, "== symbols\n")
	for i, s := range checker.ProbeSymbols(c) {
		fmt.Fprintf(w, "Y%d %s\n", i+1, strings.Join(d.fields(reflect.ValueOf(s).Elem()), " "))
	}
	if links {
		fmt.Fprintf(w, "== links\n")
		d.links()
	}
	fmt.Fprintf(w, "== diagnostics\n")
	for _, f := range d.files {
		if isLib(f) {
			continue
		}
		for _, st := range stages {
			if st == "check" {
				for _, x := range c.GetDiagnostics(context.Background(), f) {
					d.diag("D", x)
				}
			}
		}
	}
	for _, x := range c.GetGlobalDiagnostics() {
		d.diag("D.global", x)
	}
}
