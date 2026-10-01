package checker

// Research probe only. The structural oracle of the checker state: every type, signature, transient symbol and symbol
// link record of one checker, printed in creation order from fields that are already set. Printing reads fields only:
// it calls no resolver, asks for no lazy symbol id and creates no type, so a dump can be taken between any two steps.
// The text is "checker-state v1" (FORMATS.txt next to bootstrap.sh).

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/jsnum"
)

// ProbeStateOptions selects the sections of a state dump.
type ProbeStateOptions struct {
	SinceType      int  // print types with id > SinceType
	SinceSignature int  // print signatures with id > SinceSignature
	Marks          bool // the counters at the marks inside NewChecker
	Fields         bool // the named types, signatures and symbols of the checker
	Globals        bool // the names of the globals table
	Links          bool // the link records of bound and transient symbols
	DiagText       bool // the text, chain and related information of diagnostics
	Files          []*ast.SourceFile
}

type stateDumper struct {
	c         *Checker
	p         *probeState
	sb        strings.Builder
	transient map[*ast.Symbol]bool
	bound     []*ast.Symbol
	boundSet  map[*ast.Symbol]bool
	roots     []*ConditionalRoot
	rootIdx   map[*ConditionalRoot]int
	idOwner   map[uint64]*ast.Symbol
	recorded  int
}

// The symbols that the checker made since the last call are transient ones too.
func (d *stateDumper) refresh() {
	for ; d.recorded < len(d.p.symbols); d.recorded++ {
		d.transient[d.p.symbols[d.recorded]] = true
	}
}

func newStateDumper(c *Checker) *stateDumper {
	d := &stateDumper{c: c, p: probeOf(c), transient: map[*ast.Symbol]bool{}, boundSet: map[*ast.Symbol]bool{}, rootIdx: map[*ConditionalRoot]int{}, idOwner: map[uint64]*ast.Symbol{}}
	if d.p.canon == nil {
		d.p.canon = map[*ast.Symbol]int{}
	}
	d.refresh()
	return d
}

func probeQuote(s string) string {
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

func probeFileOf(n *ast.Node) *ast.SourceFile {
	for i := 0; n != nil && i < 1000000; i++ {
		if n.Kind == ast.KindSourceFile {
			return n.AsSourceFile()
		}
		n = n.Parent
	}
	return nil
}

func (d *stateDumper) nref(n *ast.Node) string {
	if n == nil {
		return "nil"
	}
	file := "?"
	if f := probeFileOf(n); f != nil {
		file = f.FileName()
	}
	return fmt.Sprintf("%s@%s:%d:%d", strings.TrimPrefix(n.Kind.String(), "Kind"), file, n.Pos(), n.End())
}

// A name that holds a lazily assigned symbol id (private members, unique symbols) is printed with the symbol of that id:
// the ids are handed out in an order that changes from run to run.
func (d *stateDumper) name(s string) string {
	if !strings.HasPrefix(s, ast.InternalSymbolNamePrefix) {
		return probeQuote(s)
	}
	rest := s[len(ast.InternalSymbolNamePrefix):]
	if strings.HasPrefix(rest, "#") {
		if at := strings.Index(rest, "@"); at > 1 {
			if id, err := strconv.ParseUint(rest[1:at], 10, 64); err == nil {
				return probeQuote(ast.InternalSymbolNamePrefix+"#") + "{" + d.owner(id) + "}" + probeQuote(rest[at:])
			}
		}
	}
	if strings.HasPrefix(rest, "@") {
		if at := strings.LastIndex(rest, "@"); at > 0 {
			if id, err := strconv.ParseUint(rest[at+1:], 10, 64); err == nil {
				return probeQuote(ast.InternalSymbolNamePrefix+rest[:at+1]) + "{" + d.owner(id) + "}"
			}
		}
	}
	return probeQuote(s)
}

func (d *stateDumper) owner(id uint64) string {
	if s, ok := d.idOwner[id]; ok {
		return d.sref(s)
	}
	return "?"
}

func (d *stateDumper) sref(s *ast.Symbol) string {
	if s == nil {
		return "nil"
	}
	// A transient symbol has the number of its first mention in the dump: the reference creates the symbols of an
	// instantiated member table in the order of a Go map, which changes from run to run.
	d.refresh()
	if d.transient[s] {
		n, ok := d.p.canon[s]
		if !ok {
			n = len(d.p.canonList) + 1
			d.p.canon[s] = n
			d.p.canonList = append(d.p.canonList, s)
		}
		return "Y" + strconv.Itoa(n)
	}
	where := "-"
	if len(s.Declarations) > 0 {
		where = d.nref(s.Declarations[0])
	}
	return fmt.Sprintf("%s@%s/%#x", d.name(s.Name), where, uint32(s.Flags))
}

func (d *stateDumper) srefs(list []*ast.Symbol) string {
	if list == nil {
		return "nil"
	}
	parts := make([]string, len(list))
	for i, s := range list {
		parts[i] = d.sref(s)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func tref(t *Type) string {
	if t == nil {
		return "nil"
	}
	return "T" + strconv.FormatUint(uint64(t.id), 10)
}

func trefs(list []*Type) string {
	if list == nil {
		return "nil"
	}
	parts := make([]string, len(list))
	for i, t := range list {
		parts[i] = tref(t)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func gref(s *Signature) string {
	if s == nil {
		return "nil"
	}
	return "S" + strconv.FormatUint(uint64(s.id), 10)
}

func grefs(list []*Signature) string {
	if list == nil {
		return "nil"
	}
	parts := make([]string, len(list))
	for i, s := range list {
		parts[i] = gref(s)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func (d *stateDumper) table(t ast.SymbolTable) string {
	if t == nil {
		return "nil"
	}
	// The entries are named in the order of their printed keys: naming a transient symbol gives it its number.
	type entry struct {
		key string
		sym *ast.Symbol
	}
	entries := make([]entry, 0, len(t))
	for k, s := range t {
		entries = append(entries, entry{d.name(k), s})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].key < entries[j].key })
	parts := make([]string, len(entries))
	for i, e := range entries {
		parts[i] = e.key + ":" + d.sref(e.sym)
	}
	return "{" + strings.Join(parts, " ") + "}"
}

// The instantiations of a cache are listed by type id: the keys are hashes.
func instList(m map[CacheHashKey]*Type) string {
	ids := make([]int, 0, len(m))
	for _, t := range m {
		if t != nil {
			ids = append(ids, int(t.id))
		}
	}
	sort.Ints(ids)
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = "T" + strconv.Itoa(id)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func (d *stateDumper) mref(m *TypeMapper) string {
	if m == nil {
		return "nil"
	}
	switch x := m.data.(type) {
	case *SimpleTypeMapper:
		return "simple(" + tref(x.source) + "=>" + tref(x.target) + ")"
	case *ArrayTypeMapper:
		return "array(" + trefs(x.sources) + "=>" + trefs(x.targets) + ")"
	case *ArrayToSingleTypeMapper:
		return "single(" + trefs(x.sources) + "=>" + tref(x.target) + ")"
	case *DeferredTypeMapper:
		return "deferred(" + trefs(x.sources) + ")"
	case *FunctionTypeMapper:
		return "function"
	case *MergedTypeMapper:
		return "merged(" + d.mref(x.m1) + "," + d.mref(x.m2) + ")"
	case *CompositeTypeMapper:
		return "composite(" + d.mref(x.m1) + "," + d.mref(x.m2) + ")"
	case *InferenceTypeMapper:
		return fmt.Sprintf("inference(fixing=%v)", x.fixing)
	}
	return fmt.Sprintf("%T", m.data)
}

func (d *stateDumper) indexInfos(list []*IndexInfo) string {
	if list == nil {
		return "nil"
	}
	parts := make([]string, len(list))
	for i, info := range list {
		parts[i] = d.indexInfo(info)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func (d *stateDumper) indexInfo(info *IndexInfo) string {
	if info == nil {
		return "nil"
	}
	s := "(" + tref(info.keyType) + ":" + tref(info.valueType)
	if info.isReadonly {
		s += " readonly"
	}
	if info.declaration != nil {
		s += " decl=" + d.nref(info.declaration)
	}
	if info.indexSymbol != nil {
		s += " sym=" + d.sref(info.indexSymbol)
	}
	if len(info.components) != 0 {
		s += " components=" + strconv.Itoa(len(info.components))
	}
	return s + ")"
}

func (d *stateDumper) predicate(p *TypePredicate) string {
	if p == nil {
		return "nil"
	}
	return fmt.Sprintf("(%d:%d:%s:%s)", int(p.kind), int(p.parameterIndex), probeQuote(p.parameterName), tref(p.t))
}

func probeLiteralValue(v any) string {
	switch x := v.(type) {
	case nil:
		return "nil"
	case string:
		return "s" + probeQuote(x)
	case jsnum.Number:
		return "n" + x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	case jsnum.PseudoBigInt:
		return "b" + x.String()
	}
	return fmt.Sprintf("?%T", v)
}

func probeDataKind(t *Type) string {
	switch t.data.(type) {
	case *IntrinsicType:
		return "Intrinsic"
	case *LiteralType:
		return "Literal"
	case *UniqueESSymbolType:
		return "UniqueESSymbol"
	case *ObjectType:
		return "Object"
	case *TypeReference:
		return "TypeReference"
	case *InterfaceType:
		return "Interface"
	case *TupleType:
		return "Tuple"
	case *InstantiationExpressionType:
		return "InstantiationExpression"
	case *MappedType:
		return "Mapped"
	case *ReverseMappedType:
		return "ReverseMapped"
	case *EvolvingArrayType:
		return "EvolvingArray"
	case *UnionType:
		return "Union"
	case *IntersectionType:
		return "Intersection"
	case *TypeParameter:
		return "TypeParameter"
	case *IndexType:
		return "Index"
	case *IndexedAccessType:
		return "IndexedAccess"
	case *TemplateLiteralType:
		return "TemplateLiteral"
	case *StringMappingType:
		return "StringMapping"
	case *SubstitutionType:
		return "Substitution"
	case *ConditionalType:
		return "Conditional"
	}
	return fmt.Sprintf("?%T", t.data)
}

func (d *stateDumper) rootRef(r *ConditionalRoot) string {
	if r == nil {
		return "nil"
	}
	i, ok := d.rootIdx[r]
	if !ok {
		i = len(d.roots) + 1
		d.rootIdx[r] = i
		d.roots = append(d.roots, r)
	}
	return "R" + strconv.Itoa(i)
}

func (d *stateDumper) structured(w *strings.Builder, t *Type, s *StructuredType) {
	if t.objectFlags&ObjectFlagsMembersResolved != 0 {
		fmt.Fprintf(w, " members=%s props=%s sigs=%s calls=%d index=%s", d.table(s.members), d.srefs(s.properties), grefs(s.signatures), s.callSignatureCount, d.indexInfos(s.indexInfos))
	}
	if s.objectTypeWithoutAbstractConstructSignatures != nil {
		fmt.Fprintf(w, " noAbstractCtor=%s", tref(s.objectTypeWithoutAbstractConstructSignatures))
	}
}

func (d *stateDumper) object(w *strings.Builder, o *ObjectType) {
	if o.target != nil {
		fmt.Fprintf(w, " target=%s", tref(o.target))
	}
	if o.mapper != nil {
		fmt.Fprintf(w, " mapper=%s", d.mref(o.mapper))
	}
	if o.instantiations != nil {
		fmt.Fprintf(w, " inst=%s", instList(o.instantiations))
	}
}

func (d *stateDumper) reference(w *strings.Builder, r *TypeReference) {
	if r.node != nil {
		fmt.Fprintf(w, " node=%s", d.nref(r.node))
	}
	fmt.Fprintf(w, " targs=%s", trefs(r.resolvedTypeArguments))
}

func (d *stateDumper) iface(w *strings.Builder, i *InterfaceType) {
	fmt.Fprintf(w, " tparams=%s outer=%d this=%s", trefs(i.allTypeParameters), i.outerTypeParameterCount, tref(i.thisType))
	if i.resolvedBaseConstructorType != nil {
		fmt.Fprintf(w, " baseCtor=%s", tref(i.resolvedBaseConstructorType))
	}
	if i.baseTypesResolved {
		fmt.Fprintf(w, " bases=%s", trefs(i.resolvedBaseTypes))
	} else if i.resolvedBaseTypes != nil {
		fmt.Fprintf(w, " basesPartial=%s", trefs(i.resolvedBaseTypes))
	}
	if i.declaredMembersResolved {
		fmt.Fprintf(w, " dmembers=%s dcalls=%s dctors=%s dindex=%s", d.table(i.declaredMembers), grefs(i.declaredCallSignatures), grefs(i.declaredConstructSignatures), d.indexInfos(i.declaredIndexInfos))
	}
}

func (d *stateDumper) typeLine(t *Type) string {
	var w strings.Builder
	fmt.Fprintf(&w, "TYPE %d flags=%#x objectFlags=%#x data=%s", t.id, uint32(t.flags), uint32(t.objectFlags), probeDataKind(t))
	if t.symbol != nil {
		fmt.Fprintf(&w, " symbol=%s", d.sref(t.symbol))
	}
	if t.alias != nil {
		fmt.Fprintf(&w, " alias=%s%s", d.sref(t.alias.symbol), trefs(t.alias.typeArguments))
	}
	if ct := t.data.AsConstrainedType(); ct != nil && ct.resolvedBaseConstraint != nil {
		fmt.Fprintf(&w, " baseConstraint=%s", tref(ct.resolvedBaseConstraint))
	}
	switch x := t.data.(type) {
	case *IntrinsicType:
		fmt.Fprintf(&w, " name=%s", probeQuote(x.intrinsicName))
	case *LiteralType:
		fmt.Fprintf(&w, " value=%s fresh=%s regular=%s", probeLiteralValue(x.value), tref(x.freshType), tref(x.regularType))
	case *UniqueESSymbolType:
		fmt.Fprintf(&w, " name=%s", d.name(x.name))
	case *ObjectType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, x)
	case *TypeReference:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		d.reference(&w, x)
	case *InterfaceType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		d.reference(&w, &x.TypeReference)
		d.iface(&w, x)
	case *TupleType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		d.reference(&w, &x.TypeReference)
		d.iface(&w, &x.InterfaceType)
		parts := make([]string, len(x.elementInfos))
		for i, e := range x.elementInfos {
			parts[i] = strconv.Itoa(int(e.flags))
			if e.labeledDeclaration != nil {
				parts[i] += ":" + d.nref(e.labeledDeclaration)
			}
		}
		fmt.Fprintf(&w, " elements=[%s] minLength=%d fixedLength=%d combinedFlags=%d readonly=%v", strings.Join(parts, " "), x.minLength, x.fixedLength, int(x.combinedFlags), x.readonly)
	case *InstantiationExpressionType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		fmt.Fprintf(&w, " node=%s", d.nref(x.node))
	case *MappedType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		decl := "nil"
		if x.declaration != nil {
			decl = d.nref(x.declaration.AsNode())
		}
		fmt.Fprintf(&w, " declaration=%s typeParameter=%s constraintType=%s nameType=%s templateType=%s modifiersType=%s resolvedApparentType=%s containsError=%v", decl, tref(x.typeParameter), tref(x.constraintType), tref(x.nameType), tref(x.templateType), tref(x.modifiersType), tref(x.resolvedApparentType), x.containsError)
	case *ReverseMappedType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		fmt.Fprintf(&w, " source=%s mappedType=%s constraintType=%s", tref(x.source), tref(x.mappedType), tref(x.constraintType))
	case *EvolvingArrayType:
		d.structured(&w, t, &x.StructuredType)
		d.object(&w, &x.ObjectType)
		fmt.Fprintf(&w, " elementType=%s finalArrayType=%s", tref(x.elementType), tref(x.finalArrayType))
	case *UnionType:
		d.structured(&w, t, &x.StructuredType)
		d.unionOrIntersection(&w, &x.UnionOrIntersectionType)
		if x.resolvedReducedType != nil {
			fmt.Fprintf(&w, " reduced=%s", tref(x.resolvedReducedType))
		}
		if x.regularType != nil {
			fmt.Fprintf(&w, " regular=%s", tref(x.regularType))
		}
		if x.origin != nil {
			fmt.Fprintf(&w, " origin=%s", tref(x.origin))
		}
		if x.keyPropertyName != "" {
			fmt.Fprintf(&w, " keyProperty=%s", d.name(x.keyPropertyName))
		}
		if x.constituentMap != nil {
			fmt.Fprintf(&w, " constituents=%d", len(x.constituentMap))
		}
	case *IntersectionType:
		d.structured(&w, t, &x.StructuredType)
		d.unionOrIntersection(&w, &x.UnionOrIntersectionType)
		if x.resolvedApparentType != nil {
			fmt.Fprintf(&w, " resolvedApparentType=%s", tref(x.resolvedApparentType))
		}
		if x.uniqueLiteralFilledInstantiation != nil {
			fmt.Fprintf(&w, " uniqueLiteralFilled=%s", tref(x.uniqueLiteralFilledInstantiation))
		}
	case *TypeParameter:
		fmt.Fprintf(&w, " constraint=%s", tref(x.constraint))
		if x.target != nil {
			fmt.Fprintf(&w, " target=%s", tref(x.target))
		}
		if x.mapper != nil {
			fmt.Fprintf(&w, " mapper=%s", d.mref(x.mapper))
		}
		if x.isThisType {
			w.WriteString(" isThisType")
		}
		if x.resolvedDefaultType != nil {
			fmt.Fprintf(&w, " default=%s", tref(x.resolvedDefaultType))
		}
	case *IndexType:
		fmt.Fprintf(&w, " target=%s indexFlags=%d", tref(x.target), int(x.indexFlags))
	case *IndexedAccessType:
		fmt.Fprintf(&w, " objectType=%s indexType=%s accessFlags=%#x", tref(x.objectType), tref(x.indexType), uint32(x.accessFlags))
	case *TemplateLiteralType:
		texts := make([]string, len(x.texts))
		for i, s := range x.texts {
			texts[i] = probeQuote(s)
		}
		fmt.Fprintf(&w, " texts=[%s] types=%s", strings.Join(texts, " "), trefs(x.types))
	case *StringMappingType:
		fmt.Fprintf(&w, " target=%s", tref(x.target))
	case *SubstitutionType:
		fmt.Fprintf(&w, " baseType=%s constraint=%s", tref(x.baseType), tref(x.constraint))
	case *ConditionalType:
		fmt.Fprintf(&w, " root=%s checkType=%s extendsType=%s", d.rootRef(x.root), tref(x.checkType), tref(x.extendsType))
		if x.resolvedTrueType != nil {
			fmt.Fprintf(&w, " trueType=%s", tref(x.resolvedTrueType))
		}
		if x.resolvedFalseType != nil {
			fmt.Fprintf(&w, " falseType=%s", tref(x.resolvedFalseType))
		}
		if x.resolvedInferredTrueType != nil {
			fmt.Fprintf(&w, " inferredTrueType=%s", tref(x.resolvedInferredTrueType))
		}
		if x.resolvedDefaultConstraint != nil {
			fmt.Fprintf(&w, " defaultConstraint=%s", tref(x.resolvedDefaultConstraint))
		}
		if x.resolvedConstraintOfDistributive != nil {
			fmt.Fprintf(&w, " constraintOfDistributive=%s", tref(x.resolvedConstraintOfDistributive))
		}
		if x.mapper != nil {
			fmt.Fprintf(&w, " mapper=%s", d.mref(x.mapper))
		}
		if x.combinedMapper != nil {
			fmt.Fprintf(&w, " combinedMapper=%s", d.mref(x.combinedMapper))
		}
	}
	return w.String()
}

func (d *stateDumper) unionOrIntersection(w *strings.Builder, u *UnionOrIntersectionType) {
	fmt.Fprintf(w, " types=%s", trefs(u.types))
	if u.propertyCache != nil {
		fmt.Fprintf(w, " propertyCache=%s", d.table(u.propertyCache))
	}
	if u.propertyCacheWithoutFunctionPropertyAugment != nil {
		fmt.Fprintf(w, " propertyCacheNoAugment=%s", d.table(u.propertyCacheWithoutFunctionPropertyAugment))
	}
	if u.resolvedProperties != nil {
		fmt.Fprintf(w, " resolvedProperties=%s", d.srefs(u.resolvedProperties))
	}
}

func (d *stateDumper) signatureLine(s *Signature) string {
	var w strings.Builder
	fmt.Fprintf(&w, "SIGNATURE %d flags=%#x minArgumentCount=%d resolvedMinArgumentCount=%d", s.id, uint32(s.flags), s.minArgumentCount, s.resolvedMinArgumentCount)
	if s.declaration != nil {
		fmt.Fprintf(&w, " declaration=%s", d.nref(s.declaration))
	}
	fmt.Fprintf(&w, " typeParameters=%s parameters=%s", trefs(s.typeParameters), d.srefs(s.parameters))
	if s.thisParameter != nil {
		fmt.Fprintf(&w, " thisParameter=%s", d.sref(s.thisParameter))
	}
	fmt.Fprintf(&w, " returnType=%s", tref(s.resolvedReturnType))
	if s.resolvedTypePredicate != nil {
		fmt.Fprintf(&w, " predicate=%s", d.predicate(s.resolvedTypePredicate))
	}
	if s.target != nil {
		fmt.Fprintf(&w, " target=%s", gref(s.target))
	}
	if s.mapper != nil {
		fmt.Fprintf(&w, " mapper=%s", d.mref(s.mapper))
	}
	if s.isolatedSignatureType != nil {
		fmt.Fprintf(&w, " isolated=%s", tref(s.isolatedSignatureType))
	}
	if s.composite != nil {
		kind := "intersection"
		if s.composite.isUnion {
			kind = "union"
		}
		fmt.Fprintf(&w, " composite=%s%s", kind, grefs(s.composite.signatures))
	}
	return w.String()
}

func (d *stateDumper) nrefs(list []*ast.Node) string {
	parts := make([]string, len(list))
	for i, n := range list {
		parts[i] = d.nref(n)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func (d *stateDumper) symbolLine(i int, s *ast.Symbol) string {
	var w strings.Builder
	fmt.Fprintf(&w, "SYMBOL Y%d name=%s flags=%#x checkFlags=%#x declarations=%s", i, d.name(s.Name), uint32(s.Flags), uint32(s.CheckFlags), d.nrefs(s.Declarations))
	if s.ValueDeclaration != nil {
		fmt.Fprintf(&w, " valueDeclaration=%s", d.nref(s.ValueDeclaration))
	}
	if s.Parent != nil {
		fmt.Fprintf(&w, " parent=%s", d.sref(s.Parent))
	}
	if s.Members != nil {
		fmt.Fprintf(&w, " members=%d", len(s.Members))
	}
	if s.Exports != nil {
		fmt.Fprintf(&w, " exports=%d", len(s.Exports))
	}
	return w.String()
}

// The link records of one symbol that hold a value. The value links are read only when the symbol has its lazy id.
func (d *stateDumper) linksOf(s *ast.Symbol) string {
	c := d.c
	var w strings.Builder
	if ast.ProbeSymbolId(s) != 0 {
		if l := c.valueSymbolLinks.TryGet(s); l != nil {
			if l.resolvedType != nil {
				fmt.Fprintf(&w, " type=%s", tref(l.resolvedType))
			}
			if l.writeType != nil {
				fmt.Fprintf(&w, " writeType=%s", tref(l.writeType))
			}
			if l.target != nil {
				fmt.Fprintf(&w, " target=%s", d.sref(l.target))
			}
			if l.mapper != nil {
				fmt.Fprintf(&w, " mapper=%s", d.mref(l.mapper))
			}
			if l.nameType != nil {
				fmt.Fprintf(&w, " nameType=%s", tref(l.nameType))
			}
			if l.containingType != nil {
				fmt.Fprintf(&w, " containingType=%s", tref(l.containingType))
			}
			if l.functionOrConstructorChecked {
				w.WriteString(" functionOrConstructorChecked")
			}
		}
	}
	if l := c.declaredTypeLinks.TryGet(s); l != nil {
		if l.declaredType != nil {
			fmt.Fprintf(&w, " declaredType=%s", tref(l.declaredType))
		}
		if l.interfaceChecked {
			w.WriteString(" interfaceChecked")
		}
		if l.indexSignaturesChecked {
			w.WriteString(" indexSignaturesChecked")
		}
		if l.typeParametersChecked {
			w.WriteString(" typeParametersChecked")
		}
		if l.enumChecked {
			w.WriteString(" enumChecked")
		}
	}
	if l := c.typeAliasLinks.TryGet(s); l != nil {
		if l.declaredType != nil {
			fmt.Fprintf(&w, " aliasDeclaredType=%s", tref(l.declaredType))
		}
		if l.typeParameters != nil {
			fmt.Fprintf(&w, " aliasTypeParameters=%s", trefs(l.typeParameters))
		}
		if l.instantiations != nil {
			fmt.Fprintf(&w, " aliasInstantiations=%s", instList(l.instantiations))
		}
		if l.isConstructorDeclaredProperty {
			w.WriteString(" isConstructorDeclaredProperty")
		}
	}
	if l := c.aliasSymbolLinks.TryGet(s); l != nil {
		if l.immediateTarget != nil {
			fmt.Fprintf(&w, " immediateTarget=%s", d.sref(l.immediateTarget))
		}
		if l.aliasTarget != nil {
			fmt.Fprintf(&w, " aliasTarget=%s", d.sref(l.aliasTarget))
		}
		if l.referenced {
			w.WriteString(" referenced")
		}
		if l.typeOnlyDeclaration != nil {
			fmt.Fprintf(&w, " typeOnlyDeclaration=%s", d.nref(l.typeOnlyDeclaration))
		}
	}
	if l := c.moduleSymbolLinks.TryGet(s); l != nil {
		if l.resolvedExports != nil {
			fmt.Fprintf(&w, " moduleResolvedExports=%s", d.table(l.resolvedExports))
		}
		if l.typeOnlyExportStarMap != nil {
			fmt.Fprintf(&w, " typeOnlyExportStar=%d", len(l.typeOnlyExportStarMap))
		}
		if l.exportsChecked {
			w.WriteString(" exportsChecked")
		}
	}
	if l := c.membersAndExportsLinks.TryGet(s); l != nil {
		if l[MembersOrExportsResolutionKindResolvedExports] != nil {
			fmt.Fprintf(&w, " resolvedExports=%s", d.table(l[MembersOrExportsResolutionKindResolvedExports]))
		}
		if l[MembersOrExportsResolutionKindResolvedMembers] != nil {
			fmt.Fprintf(&w, " resolvedMembers=%s", d.table(l[MembersOrExportsResolutionKindResolvedMembers]))
		}
	}
	if l := c.mappedSymbolLinks.TryGet(s); l != nil {
		if l.keyType != nil {
			fmt.Fprintf(&w, " keyType=%s", tref(l.keyType))
		}
		if l.syntheticOrigin != nil {
			fmt.Fprintf(&w, " syntheticOrigin=%s", d.sref(l.syntheticOrigin))
		}
	}
	if l := c.deferredSymbolLinks.TryGet(s); l != nil {
		if l.parent != nil {
			fmt.Fprintf(&w, " deferredParent=%s", tref(l.parent))
		}
		if l.constituents != nil {
			fmt.Fprintf(&w, " constituents=%s", trefs(l.constituents))
		}
		if l.writeConstituents != nil {
			fmt.Fprintf(&w, " writeConstituents=%s", trefs(l.writeConstituents))
		}
	}
	if l := c.lateBoundLinks.TryGet(s); l != nil && l.lateSymbol != nil {
		fmt.Fprintf(&w, " lateSymbol=%s", d.sref(l.lateSymbol))
	}
	if l := c.exportTypeLinks.TryGet(s); l != nil {
		if l.target != nil {
			fmt.Fprintf(&w, " exportTypeTarget=%s", d.sref(l.target))
		}
		if l.originatingImport != nil {
			fmt.Fprintf(&w, " originatingImport=%s", d.nref(l.originatingImport))
		}
	}
	if l := c.spreadLinks.TryGet(s); l != nil && (l.leftSpread != nil || l.rightSpread != nil) {
		fmt.Fprintf(&w, " leftSpread=%s rightSpread=%s", d.sref(l.leftSpread), d.sref(l.rightSpread))
	}
	if l := c.varianceLinks.TryGet(s); l != nil && l.variances != nil {
		parts := make([]string, len(l.variances))
		for i, v := range l.variances {
			parts[i] = strconv.Itoa(int(v))
		}
		fmt.Fprintf(&w, " variances=[%s]", strings.Join(parts, " "))
	}
	if l := c.ReverseMappedSymbolLinks.TryGet(s); l != nil && (l.propertyType != nil || l.mappedType != nil || l.constraintType != nil) {
		fmt.Fprintf(&w, " reverseMapped=(%s %s %s)", tref(l.propertyType), tref(l.mappedType), tref(l.constraintType))
	}
	if l := c.symbolReferenceLinks.TryGet(s); l != nil && l.referenceKinds != 0 {
		fmt.Fprintf(&w, " referenceKinds=%#x", uint32(l.referenceKinds))
	}
	if m := c.mergedSymbols[s]; m != nil {
		fmt.Fprintf(&w, " merged=%s", d.sref(m))
	}
	return w.String()
}

func probeSortedKeys(t ast.SymbolTable) []string {
	keys := make([]string, 0, len(t))
	for k := range t {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Bound symbols in the order of the bind dump: the walk of binder-port-and-fixtures/groundtruth/dumpbind, file by file.
func (d *stateDumper) visitBound(root *ast.Symbol) {
	stack := []*ast.Symbol{root}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if s == nil || d.boundSet[s] {
			continue
		}
		if d.transient[s] {
			continue
		}
		d.boundSet[s] = true
		d.bound = append(d.bound, s)
		var next []*ast.Symbol
		for _, k := range probeSortedKeys(s.Members) {
			next = append(next, s.Members[k])
		}
		for _, k := range probeSortedKeys(s.Exports) {
			next = append(next, s.Exports[k])
		}
		next = append(next, s.Parent, s.ExportSymbol)
		for i := len(next) - 1; i >= 0; i-- {
			stack = append(stack, next[i])
		}
	}
}

func (d *stateDumper) collectBound(files []*ast.SourceFile) {
	for _, sf := range files {
		d.visitBound(sf.Symbol)
		for _, k := range probeSortedKeys(sf.GlobalExports) {
			d.visitBound(sf.GlobalExports[k])
		}
		for _, p := range sf.PatternAmbientModules {
			d.visitBound(p.Symbol)
		}
		probeWalk(sf.AsNode(), func(n *ast.Node) {
			if data := n.DeclarationData(); data != nil {
				d.visitBound(data.Symbol)
			}
			if data := n.ExportableData(); data != nil {
				d.visitBound(data.LocalSymbol)
			}
			if data := n.LocalsContainerData(); data != nil {
				for _, k := range probeSortedKeys(data.Locals) {
					d.visitBound(data.Locals[k])
				}
			}
		})
	}
}

// Visits a tree in source order without recursion.
func probeWalk(root *ast.Node, visit func(n *ast.Node)) {
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

// ProbeCounts returns the two creation counters that are the same in every run: a later dump can start after them.
func ProbeCounts(c *Checker) (int, int) {
	return int(c.TypeCount), int(c.SignatureCount)
}

// ProbeStateDump prints the state section of "checker-state v1".
func ProbeStateDump(c *Checker, o ProbeStateOptions) string {
	d := newStateDumper(c)
	d.collectBound(o.Files)
	for _, s := range d.bound {
		if id := ast.ProbeSymbolId(s); id != 0 {
			d.idOwner[id] = s
		}
	}
	for _, s := range d.p.symbols {
		if id := ast.ProbeSymbolId(s); id != 0 {
			d.idOwner[id] = s
		}
	}
	w := &d.sb
	if o.Marks {
		for _, m := range d.p.marks {
			fmt.Fprintf(w, "MARK %s\n", m)
		}
	}
	fmt.Fprintf(w, "COUNTS TypeCount=%d SymbolCount=%d SignatureCount=%d TotalInstantiationCount=%d transientSymbols=%d mergedSymbols=%d globals=%d\n", c.TypeCount, c.SymbolCount, c.SignatureCount, c.TotalInstantiationCount, len(d.p.symbols), len(c.mergedSymbols), len(c.globals))
	w.WriteString(ProbeState(c))
	fmt.Fprintf(w, "SIZES %s\n", RelProbeSizes(c))
	fmt.Fprintf(w, "RESOLUTIONSTACK %d %v\n", c.ProbeResolutionDepth(), c.ProbeResolutionStack())
	var lines []string
	for _, t := range d.p.types {
		if int(t.id) > o.SinceType {
			lines = append(lines, d.typeLine(t))
		}
	}
	for _, l := range lines {
		w.WriteString(l)
		w.WriteByte('\n')
	}
	for i, r := range d.roots {
		node := "nil"
		if r.node != nil {
			node = d.nref(r.node.AsNode())
		}
		fmt.Fprintf(w, "ROOT R%d node=%s checkType=%s extendsType=%s distributive=%v inferTypeParameters=%s outerTypeParameters=%s", i+1, node, tref(r.checkType), tref(r.extendsType), r.isDistributive, trefs(r.inferTypeParameters), trefs(r.outerTypeParameters))
		if r.instantiations != nil {
			fmt.Fprintf(w, " inst=%s", instList(r.instantiations))
		}
		if r.alias != nil {
			fmt.Fprintf(w, " alias=%s%s", d.sref(r.alias.symbol), trefs(r.alias.typeArguments))
		}
		w.WriteByte('\n')
	}
	for _, s := range d.p.signatures {
		if int(s.id) > o.SinceSignature {
			w.WriteString(d.signatureLine(s))
			w.WriteByte('\n')
		}
	}
	if o.Links {
		for _, s := range d.bound {
			if l := d.linksOf(s); l != "" {
				fmt.Fprintf(w, "LINKS %s%s\n", d.sref(s), l)
			}
		}
	}
	if o.Fields {
		d.fields()
	}
	names := make([]string, 0, len(c.globals))
	transient := 0
	for k, s := range c.globals {
		names = append(names, k)
		if s.Flags&ast.SymbolFlagsTransient != 0 {
			transient++
		}
	}
	sort.Strings(names)
	fmt.Fprintf(w, "GLOBALS count=%d transient=%d\n", len(names), transient)
	if o.Globals {
		for _, k := range names {
			fmt.Fprintf(w, "GLOBAL %s %s\n", d.name(k), d.sref(c.globals[k]))
		}
	}
	// GetGlobalDiagnostics sorts the list of the collection in place: the copy of GetDiagnostics is read instead.
	for _, x := range c.diagnostics.GetDiagnostics() {
		if x.File() == nil {
			d.diagnostic("GLOBALDIAG", x, o.DiagText, "")
		}
	}
	for _, x := range c.diagnostics.GetDiagnostics() {
		if x.File() != nil {
			d.diagnostic("DIAG", x, o.DiagText, "")
		}
	}
	for _, x := range c.suggestionDiagnostics.GetDiagnostics() {
		d.diagnostic("SUGGESTION", x, o.DiagText, "")
	}
	// The transient symbols that the lines above name, and the ones that these symbols name, in the order of first mention.
	for i := 0; i < len(d.p.canonList); i++ {
		s := d.p.canonList[i]
		line := d.symbolLine(i+1, s)
		if o.Links {
			line += d.linksOf(s)
		}
		w.WriteString(line)
		w.WriteByte('\n')
	}
	fmt.Fprintf(w, "SYMBOLS named=%d unnamed=%d\n", len(d.p.canonList), len(d.p.symbols)-len(d.p.canonList))
	return w.String()
}

// The fields of the checker that hold one type, signature or symbol, in declaration order.
func (d *stateDumper) fields() {
	w := &d.sb
	v := reflect.ValueOf(d.c).Elem()
	tt := v.Type()
	typePtr := reflect.TypeOf((*Type)(nil))
	sigPtr := reflect.TypeOf((*Signature)(nil))
	symPtr := reflect.TypeOf((*ast.Symbol)(nil))
	for i := 0; i < tt.NumField(); i++ {
		f := tt.Field(i)
		fv := v.Field(i)
		switch f.Type {
		case typePtr:
			fmt.Fprintf(w, "FIELD %s %s\n", f.Name, tref((*Type)(fv.UnsafePointer())))
		case sigPtr:
			fmt.Fprintf(w, "FIELD %s %s\n", f.Name, gref((*Signature)(fv.UnsafePointer())))
		case symPtr:
			fmt.Fprintf(w, "FIELD %s %s\n", f.Name, d.sref((*ast.Symbol)(fv.UnsafePointer())))
		}
	}
}

func (d *stateDumper) diagnostic(label string, x *ast.Diagnostic, text bool, indent string) {
	w := &d.sb
	file := "-"
	if x.File() != nil {
		file = x.File().FileName()
	}
	fmt.Fprintf(w, "%s%s %s(%d,%d) TS%d category=%d", indent, label, file, x.Pos(), x.End(), x.Code(), int(x.Category()))
	if text {
		fmt.Fprintf(w, " %s", probeQuote(x.String()))
	}
	w.WriteByte('\n')
	if text {
		for _, m := range x.MessageChain() {
			d.chain(m, indent+"  ")
		}
	}
	for _, r := range x.RelatedInformation() {
		d.diagnostic("RELATED", r, text, indent+"  ")
	}
}

func (d *stateDumper) chain(x *ast.Diagnostic, indent string) {
	fmt.Fprintf(&d.sb, "%sCHAIN TS%d %s\n", indent, x.Code(), probeQuote(x.String()))
	for _, m := range x.MessageChain() {
		d.chain(m, indent+"  ")
	}
}

// ProbeUserNodes returns the nodes of the files in source order.
func probeNodes(files []*ast.SourceFile) []*ast.Node {
	var out []*ast.Node
	for _, f := range files {
		probeWalk(f.AsNode(), func(n *ast.Node) { out = append(out, n) })
	}
	return out
}

func probeGuard(out *[]string, label string, f func()) {
	defer func() {
		if r := recover(); r != nil {
			*out = append(*out, fmt.Sprintf("PANIC %s %s", label, probeQuote(fmt.Sprint(r))))
		}
	}()
	f()
}

func probeNodeRef(n *ast.Node) string {
	d := &stateDumper{}
	return d.nref(n)
}

// ProbeDrive runs one step on the files and returns one line per call. Each step calls entry points of one layer
// group in source order, so that a port can be compared when that group lands:
//
//	lit         a fixed list of literal, union, intersection and template literal constructions over the intrinsic types
//	tuple       a fixed list of array and tuple constructions over the intrinsic types
//	proptypes   getTypeOfSymbol of every property of every object, union and intersection type
//	declared    getDeclaredTypeOfSymbol of every class, interface, type alias, enum, enum member and type parameter
//	typenodes   getTypeFromTypeNode of every type node
//	symtypes    getTypeOfSymbol of every declaration with a value meaning
//	signatures  getSignatureFromDeclaration, getReturnTypeOfSignature and getTypePredicateOfSignature of every function-like node
//	constraints getConstraintOfTypeParameter, getDefaultFromTypeParameter and getBaseConstraintOfType of every type
//	bases       getBaseTypes (and getBaseConstructorTypeOfClass) of every class or interface type
//	members     resolveStructuredTypeMembers of every object, union and intersection type
//	lookup      getPropertiesOfType, getSignaturesOfType for both kinds and getIndexInfosOfType of every type
//	apparent    getApparentType and getReducedType of every type
//	widen       getWidenedType, getWidenedLiteralType, getRegularTypeOfLiteralType and getBaseTypeOfLiteralType of every type
//	keyof       getIndexType of every type
//	rel         the five relations between the declared types of the top-level variables of the last file
//	check       the diagnostics of every file
//
// The steps that say "every type" visit the types that exist when the step starts, in id order, from id > since.
func ProbeDrive(c *Checker, files []*ast.SourceFile, step string, since int) []string {
	var out []string
	snapshot := append([]*Type(nil), probeOf(c).types...)
	each := func(f func(t *Type)) {
		for _, t := range snapshot {
			if int(t.id) > since {
				probeGuard(&out, step+" "+tref(t), func() { f(t) })
			}
		}
	}
	d := newStateDumper(c)
	sym := d.sref
	switch step {
	case "lit":
		say := func(label string, t *Type) { out = append(out, "LIT "+label+" "+tref(t)) }
		probeGuard(&out, step, func() {
			a := c.getStringLiteralType("a")
			say(`"a"`, a)
			say(`"a" again`, c.getStringLiteralType("a"))
			b := c.getStringLiteralType("b")
			say(`"b"`, b)
			one := c.getNumberLiteralType(jsnum.Number(1))
			say("1", one)
			say("0", c.getNumberLiteralType(jsnum.Number(0)))
			say("-0", c.getNumberLiteralType(jsnum.Number(math.Copysign(0, -1))))
			say("12n", c.getBigIntLiteralType(jsnum.NewPseudoBigInt("12", false)))
			fa := c.getFreshTypeOfLiteralType(a)
			say(`fresh "a"`, fa)
			say(`regular of fresh "a"`, c.getRegularTypeOfLiteralType(fa))
			sn := c.getUnionType([]*Type{c.stringType, c.numberType})
			say("string | number", sn)
			say("number | string", c.getUnionType([]*Type{c.numberType, c.stringType}))
			ab := c.getUnionType([]*Type{b, a})
			say(`"b" | "a"`, ab)
			say(`"a" | "b" | string`, c.getUnionType([]*Type{a, b, c.stringType}))
			say(`("b" | "a") | 1 | undefined | null`, c.getUnionType([]*Type{ab, one, c.undefinedType, c.nullType}))
			say(`fresh "a" | "b"`, c.getUnionType([]*Type{fa, b}))
			say("true | false", c.getUnionType([]*Type{c.trueType, c.falseType}))
			say("never | string", c.getUnionType([]*Type{c.neverType, c.stringType}))
			say("any | string", c.getUnionType([]*Type{c.anyType, c.stringType}))
			say("unknown | string", c.getUnionType([]*Type{c.unknownType, c.stringType}))
			say(`"a" | "b" | string, no reduction`, c.getUnionTypeEx([]*Type{a, b, c.stringType}, UnionReductionNone, nil, nil))
			say("string & number", c.getIntersectionType([]*Type{c.stringType, c.numberType}))
			say(`string & "a"`, c.getIntersectionType([]*Type{c.stringType, a}))
			say("(string | number) & string", c.getIntersectionType([]*Type{sn, c.stringType}))
			say(`("b" | "a") & ("b" | 1)`, c.getIntersectionType([]*Type{ab, c.getUnionType([]*Type{b, one})}))
			say("{} & string", c.getIntersectionType([]*Type{c.emptyObjectType, c.stringType}))
			say("unknown & string", c.getIntersectionType([]*Type{c.unknownType, c.stringType}))
			say("object & {}", c.getIntersectionType([]*Type{c.nonPrimitiveType, c.emptyObjectType}))
			say("`id-${number}`", c.getTemplateLiteralType([]string{"id-", ""}, []*Type{c.numberType}))
			say("`id-${\"a\" | \"b\"}`", c.getTemplateLiteralType([]string{"id-", ""}, []*Type{ab}))
		})
	case "tuple":
		say := func(label string, t *Type) { out = append(out, "TUPLE "+label+" "+tref(t)) }
		probeGuard(&out, step, func() {
			say("string[]", c.createArrayType(c.stringType))
			say("string[] again", c.createArrayType(c.stringType))
			say("readonly number[]", c.createArrayTypeEx(c.numberType, true))
			sn := c.createTupleType([]*Type{c.stringType, c.numberType})
			say("[string, number]", sn)
			say("[string, number] again", c.createTupleType([]*Type{c.stringType, c.numberType}))
			say("[string, number?]", c.createTupleTypeEx([]*Type{c.stringType, c.numberType}, []TupleElementInfo{{flags: ElementFlagsRequired}, {flags: ElementFlagsOptional}}, false))
			say("readonly [string, ...number[]]", c.createTupleTypeEx([]*Type{c.stringType, c.numberType}, []TupleElementInfo{{flags: ElementFlagsRequired}, {flags: ElementFlagsRest}}, true))
			say("[...string[], number]", c.createTupleTypeEx([]*Type{c.stringType, c.numberType}, []TupleElementInfo{{flags: ElementFlagsRest}, {flags: ElementFlagsRequired}}, false))
			say("[]", c.createTupleType(nil))
			say("[[string, number]]", c.createTupleType([]*Type{sn}))
			say("[string, number][]", c.createArrayType(sn))
		})
	case "proptypes":
		each(func(t *Type) {
			if t.flags&(TypeFlagsObject|TypeFlagsUnionOrIntersection) == 0 {
				return
			}
			for _, p := range c.getPropertiesOfType(t) {
				out = append(out, fmt.Sprintf("PROPTYPE %s %s %s", tref(t), d.name(p.Name), tref(c.getTypeOfSymbol(p))))
			}
		})
	case "declared":
		for _, n := range probeNodes(files) {
			switch n.Kind {
			case ast.KindClassDeclaration, ast.KindClassExpression, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEnumDeclaration, ast.KindEnumMember, ast.KindTypeParameter:
				probeGuard(&out, step+" "+probeNodeRef(n), func() {
					s := c.getSymbolOfDeclaration(n)
					if s == nil {
						out = append(out, fmt.Sprintf("DECLARED %s nil", probeNodeRef(n)))
						return
					}
					t := c.getDeclaredTypeOfSymbol(s)
					out = append(out, fmt.Sprintf("DECLARED %s %s", probeNodeRef(n), tref(t)))
				})
			}
		}
	case "typenodes":
		for _, n := range probeNodes(files) {
			if ast.IsTypeNode(n) {
				probeGuard(&out, step+" "+probeNodeRef(n), func() {
					t := c.getTypeFromTypeNode(n)
					out = append(out, fmt.Sprintf("TYPENODE %s %s", probeNodeRef(n), tref(t)))
				})
			}
		}
	case "symtypes":
		for _, n := range probeNodes(files) {
			if n.Kind == ast.KindSourceFile {
				continue
			}
			data := n.DeclarationData()
			if data == nil || data.Symbol == nil {
				continue
			}
			if data.Symbol.Flags&(ast.SymbolFlagsVariable|ast.SymbolFlagsProperty|ast.SymbolFlagsFunction|ast.SymbolFlagsMethod|ast.SymbolFlagsClass|ast.SymbolFlagsEnum|ast.SymbolFlagsEnumMember|ast.SymbolFlagsValueModule|ast.SymbolFlagsAccessor) == 0 {
				continue
			}
			probeGuard(&out, step+" "+probeNodeRef(n), func() {
				s := c.getSymbolOfDeclaration(n)
				t := c.getTypeOfSymbol(s)
				out = append(out, fmt.Sprintf("SYMTYPE %s %s %s", probeNodeRef(n), sym(s), tref(t)))
			})
		}
	case "signatures":
		for _, n := range probeNodes(files) {
			if !ast.IsFunctionLike(n) {
				continue
			}
			probeGuard(&out, step+" "+probeNodeRef(n), func() {
				s := c.getSignatureFromDeclaration(n)
				r := c.getReturnTypeOfSignature(s)
				p := c.getTypePredicateOfSignature(s)
				out = append(out, fmt.Sprintf("SIGNATUREOF %s %s returnType=%s predicate=%s", probeNodeRef(n), gref(s), tref(r), d.predicate(p)))
			})
		}
	case "constraints":
		each(func(t *Type) {
			if t.flags&TypeFlagsTypeParameter != 0 {
				out = append(out, fmt.Sprintf("CONSTRAINT %s constraint=%s default=%s", tref(t), tref(c.getConstraintOfTypeParameter(t)), tref(c.getDefaultFromTypeParameter(t))))
			}
			if t.flags&(TypeFlagsInstantiable|TypeFlagsUnionOrIntersection) != 0 {
				out = append(out, fmt.Sprintf("BASECONSTRAINT %s %s", tref(t), tref(c.getBaseConstraintOfType(t))))
			}
		})
	case "bases":
		each(func(t *Type) {
			if t.flags&TypeFlagsObject == 0 || t.objectFlags&ObjectFlagsClassOrInterface == 0 {
				return
			}
			line := fmt.Sprintf("BASES %s %s", tref(t), trefs(c.getBaseTypes(t)))
			if t.symbol != nil && t.symbol.Flags&ast.SymbolFlagsClass != 0 {
				line += " baseCtor=" + tref(c.getBaseConstructorTypeOfClass(t))
			}
			out = append(out, line)
		})
	case "members":
		each(func(t *Type) {
			if t.flags&(TypeFlagsObject|TypeFlagsUnionOrIntersection) != 0 {
				c.resolveStructuredTypeMembers(t)
				out = append(out, fmt.Sprintf("MEMBERS %s", tref(t)))
			}
		})
	case "lookup":
		each(func(t *Type) {
			props := c.getPropertiesOfType(t)
			names := make([]string, len(props))
			for i, p := range props {
				names[i] = d.name(p.Name)
			}
			out = append(out, fmt.Sprintf("LOOKUP %s properties=[%s] call=%s construct=%s index=%d", tref(t), strings.Join(names, " "), grefs(c.getSignaturesOfType(t, SignatureKindCall)), grefs(c.getSignaturesOfType(t, SignatureKindConstruct)), len(c.getIndexInfosOfType(t))))
		})
	case "apparent":
		each(func(t *Type) {
			out = append(out, fmt.Sprintf("APPARENT %s apparent=%s reduced=%s", tref(t), tref(c.getApparentType(t)), tref(c.getReducedType(t))))
		})
	case "widen":
		each(func(t *Type) {
			line := fmt.Sprintf("WIDEN %s widened=%s widenedLiteral=%s baseOfLiteral=%s", tref(t), tref(c.getWidenedType(t)), tref(c.getWidenedLiteralType(t)), tref(c.getBaseTypeOfLiteralType(t)))
			if t.flags&TypeFlagsFreshable != 0 {
				line += " regular=" + tref(c.getRegularTypeOfLiteralType(t)) + " fresh=" + tref(c.getFreshTypeOfLiteralType(t))
			}
			out = append(out, line)
		})
	case "keyof":
		each(func(t *Type) {
			out = append(out, fmt.Sprintf("KEYOF %s %s", tref(t), tref(c.getIndexType(t))))
		})
	case "rel":
		if len(files) == 0 {
			break
		}
		file := files[len(files)-1]
		var names []string
		var types []*Type
		for _, s := range file.Statements.Nodes {
			if s.Kind != ast.KindVariableStatement {
				continue
			}
			for _, decl := range s.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if decl.Name().Kind != ast.KindIdentifier {
					continue
				}
				probeGuard(&out, step+" "+probeNodeRef(decl), func() {
					t := c.getTypeOfSymbol(c.getSymbolOfDeclaration(decl))
					names = append(names, decl.Name().Text())
					types = append(types, t)
				})
			}
		}
		relations := []*Relation{c.identityRelation, c.assignableRelation, c.comparableRelation, c.subtypeRelation, c.strictSubtypeRelation}
		for i := range types {
			for j := range types {
				probeGuard(&out, step+" "+names[i]+" "+names[j], func() {
					bits := make([]byte, len(relations))
					for k, r := range relations {
						bits[k] = '0'
						if c.isTypeRelatedTo(types[i], types[j], r) {
							bits[k] = '1'
						}
					}
					out = append(out, fmt.Sprintf("REL %s(%s) %s(%s) %s", names[i], tref(types[i]), names[j], tref(types[j]), string(bits)))
				})
			}
		}
	case "check":
		for _, f := range files {
			probeGuard(&out, step+" "+f.FileName(), func() {
				n := len(c.GetDiagnostics(context.Background(), f))
				out = append(out, fmt.Sprintf("CHECK %s diagnostics=%d", f.FileName(), n))
			})
		}
	default:
		out = append(out, "UNKNOWNSTEP "+step)
	}
	return out
}
