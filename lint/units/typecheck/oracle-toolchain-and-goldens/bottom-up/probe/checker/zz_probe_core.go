package checker

import (
	"fmt"
	"reflect"
	"sort"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
)

type probeState struct {
	types      []*Type
	symbols    []*ast.Symbol
	signatures []*Signature
	marks      []string
	// transient symbols in the order in which a state dump first names them
	canon     map[*ast.Symbol]int
	canonList []*ast.Symbol
}

// ProbeRecordOn turns the recording hooks on. Off, the hooks keep nothing and the checker behaves as the reference.
var ProbeRecordOn bool

var probes = map[*Checker]*probeState{}

func probeOf(c *Checker) *probeState {
	p := probes[c]
	if p == nil {
		p = &probeState{}
		probes[c] = p
	}
	return p
}

func probeRecordType(c *Checker, t *Type) {
	if ProbeRecordOn {
		p := probeOf(c)
		p.types = append(p.types, t)
	}
}

func probeRecordSymbol(c *Checker, s *ast.Symbol) {
	if ProbeRecordOn {
		p := probeOf(c)
		p.symbols = append(p.symbols, s)
	}
}

func probeRecordSignature(c *Checker, s *Signature) {
	if ProbeRecordOn {
		p := probeOf(c)
		p.signatures = append(p.signatures, s)
	}
}

func probeMark(c *Checker, name string) {
	if !ProbeRecordOn {
		return
	}
	p := probeOf(c)
	p.marks = append(p.marks, fmt.Sprintf("%s: TypeCount=%d SymbolCount=%d SignatureCount=%d globals=%d mergedSymbols=%d diagnostics=%d", name, c.TypeCount, c.SymbolCount, c.SignatureCount, len(c.globals), len(c.mergedSymbols), len(c.diagnostics.GetGlobalDiagnostics())))
}

func probeName(s string) string {
	return strings.ReplaceAll(s, "\xFE", "\\xFE")
}

func ProbeDump(c *Checker, maxTypes int) string {
	var sb strings.Builder
	p := probeOf(c)
	probeMark(c, "after NewChecker returned")
	for _, m := range p.marks {
		fmt.Fprintf(&sb, "MARK %s\n", m)
	}
	idOf := map[*Type]TypeId{}
	for _, t := range p.types {
		idOf[t] = t.id
	}
	for i, t := range p.types {
		if i >= maxTypes {
			break
		}
		kind := strings.TrimPrefix(reflect.TypeOf(t.data).String(), "*checker.")
		extra := ""
		switch d := t.data.(type) {
		case *IntrinsicType:
			extra = fmt.Sprintf(" name=%q", d.intrinsicName)
		case *LiteralType:
			extra = fmt.Sprintf(" value=%v(%T) fresh=%d regular=%d", d.value, d.value, idOrZero(d.freshType), idOrZero(d.regularType))
		case *UnionType:
			ids := []string{}
			for _, u := range d.types {
				ids = append(ids, fmt.Sprint(u.id))
			}
			extra = " types=[" + strings.Join(ids, ",") + "]"
		case *TemplateLiteralType:
			ids := []string{}
			for _, u := range d.types {
				ids = append(ids, fmt.Sprint(u.id))
			}
			extra = fmt.Sprintf(" texts=%q types=[%s]", d.texts, strings.Join(ids, ","))
		case *TypeParameter:
			extra = fmt.Sprintf(" constraint=%d", idOrZero(d.constraint))
		}
		if t.symbol != nil {
			extra += fmt.Sprintf(" symbol=%q", probeName(t.symbol.Name))
		}
		fmt.Fprintf(&sb, "TYPE %d flags=%s(0x%x) objectFlags=0x%x data=%s%s\n", t.id, strings.Join(FormatTypeFlags(t.flags), "|"), uint32(t.flags), uint32(t.objectFlags), kind, extra)
	}
	v := reflect.ValueOf(c).Elem()
	tt := v.Type()
	typePtr := reflect.TypeOf((*Type)(nil))
	sigPtr := reflect.TypeOf((*Signature)(nil))
	symPtr := reflect.TypeOf((*ast.Symbol)(nil))
	symIndex := map[*ast.Symbol]int{}
	for i, s := range p.symbols {
		symIndex[s] = i + 1
	}
	for i := 0; i < tt.NumField(); i++ {
		f := tt.Field(i)
		fv := v.Field(i)
		switch f.Type {
		case typePtr:
			if fv.IsNil() {
				fmt.Fprintf(&sb, "FIELD %s type=nil\n", f.Name)
			} else {
				t := (*Type)(fv.UnsafePointer())
				fmt.Fprintf(&sb, "FIELD %s type=%d\n", f.Name, t.id)
			}
		case sigPtr:
			if !fv.IsNil() {
				s := (*Signature)(fv.UnsafePointer())
				fmt.Fprintf(&sb, "FIELD %s signature=%d returns=%d\n", f.Name, s.id, idOrZero(s.resolvedReturnType))
			}
		case symPtr:
			if !fv.IsNil() {
				s := (*ast.Symbol)(fv.UnsafePointer())
				fmt.Fprintf(&sb, "FIELD %s symbol#%d name=%q flags=0x%x checkFlags=0x%x\n", f.Name, symIndex[s], probeName(s.Name), uint32(s.Flags), uint32(s.CheckFlags))
			}
		}
	}
	for i, s := range p.symbols {
		if i >= 40 {
			fmt.Fprintf(&sb, "SYMBOL ... %d more\n", len(p.symbols)-40)
			break
		}
		fmt.Fprintf(&sb, "SYMBOL #%d name=%q flags=0x%x checkFlags=0x%x decls=%d\n", i+1, probeName(s.Name), uint32(s.Flags), uint32(s.CheckFlags), len(s.Declarations))
	}
	names := make([]string, 0, len(c.globals))
	transient := 0
	for k, s := range c.globals {
		names = append(names, probeName(k))
		if s.Flags&ast.SymbolFlagsTransient != 0 {
			transient++
		}
	}
	sort.Strings(names)
	fmt.Fprintf(&sb, "GLOBALS count=%d transient=%d\n", len(names), transient)
	if len(names) <= 40 {
		fmt.Fprintf(&sb, "GLOBALS names=%q\n", names)
	}
	for _, d := range c.diagnostics.GetGlobalDiagnostics() {
		fmt.Fprintf(&sb, "GLOBALDIAG TS%d %s\n", d.Code(), d.String())
	}
	for _, d := range c.diagnostics.GetDiagnostics() {
		fn := ""
		if d.File() != nil {
			fn = d.File().FileName()
		}
		fmt.Fprintf(&sb, "DIAG %s(%d,%d) TS%d %s\n", fn, d.Pos(), d.End(), d.Code(), d.String())
	}
	return sb.String()
}

func idOrZero(t *Type) TypeId {
	if t == nil {
		return 0
	}
	return t.id
}

func probeSymbolRef(c *Checker, s *ast.Symbol) string {
	if s == nil {
		return "nil"
	}
	if s == c.unknownSymbol {
		return "unknownSymbol"
	}
	where := "-"
	if len(s.Declarations) > 0 {
		d := s.Declarations[0]
		where = fmt.Sprintf("%s@%s:%d", d.Kind.String(), ast.GetSourceFileOfNode(d).FileName(), d.Pos())
	}
	return fmt.Sprintf("%q flags=0x%x decls=%d first=%s", probeName(s.Name), uint32(s.Flags), len(s.Declarations), where)
}

func ProbeAliases(c *Checker, files []*ast.SourceFile) string {
	var sb strings.Builder
	for _, file := range files {
		if strings.HasPrefix(file.FileName(), "/lib.") {
			continue
		}
		fmt.Fprintf(&sb, "FILE %s\n", file.FileName())
		names := make([]string, 0, len(file.Locals))
		for k := range file.Locals {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			s := file.Locals[k]
			if s.Flags&ast.SymbolFlagsAlias == 0 {
				continue
			}
			target := c.resolveAlias(s)
			links := c.aliasSymbolLinks.Get(s)
			typeOnly := "nil"
			if links.typeOnlyDeclaration != nil {
				typeOnly = fmt.Sprintf("%s@%d", links.typeOnlyDeclaration.Kind.String(), links.typeOnlyDeclaration.Pos())
			}
			fmt.Fprintf(&sb, "  ALIAS %q flags=0x%x -> %s | getSymbolFlags=0x%x typeOnly=%s\n", probeName(k), uint32(s.Flags), probeSymbolRef(c, target), uint32(c.getSymbolFlags(s)), typeOnly)
		}
		if file.Symbol != nil {
			exports := c.getExportsOfModule(file.Symbol)
			names = names[:0]
			for k := range exports {
				names = append(names, k)
			}
			sort.Strings(names)
			for _, k := range names {
				s := exports[k]
				resolved := c.resolveSymbol(s)
				fmt.Fprintf(&sb, "  EXPORT %q flags=0x%x transient=%v -> %s\n", probeName(k), uint32(s.Flags), s.Flags&ast.SymbolFlagsTransient != 0, probeSymbolRef(c, resolved))
			}
			keys := make([]string, 0)
			for k, n := range c.moduleSymbolLinks.Get(file.Symbol).typeOnlyExportStarMap {
				keys = append(keys, fmt.Sprintf("%s=%s@%d", k, n.Kind.String(), n.Pos()))
			}
			sort.Strings(keys)
			if len(keys) > 0 {
				fmt.Fprintf(&sb, "  TYPEONLYEXPORTSTAR %v\n", keys)
			}
		}
	}
	fmt.Fprintf(&sb, "COUNTS TypeCount=%d SymbolCount=%d SignatureCount=%d mergedSymbols=%d typeResolutions=%d\n", c.TypeCount, c.SymbolCount, c.SignatureCount, len(c.mergedSymbols), len(c.typeResolutions))
	for _, d := range c.diagnostics.GetDiagnostics() {
		fn := ""
		if d.File() != nil {
			fn = d.File().FileName()
		}
		fmt.Fprintf(&sb, "DIAG %s(%d,%d) TS%d %s\n", fn, d.Pos(), d.End(), d.Code(), d.String())
		for _, r := range d.RelatedInformation() {
			rf := ""
			if r.File() != nil {
				rf = r.File().FileName()
			}
			fmt.Fprintf(&sb, "  RELATED %s(%d,%d) TS%d %s\n", rf, r.Pos(), r.End(), r.Code(), r.String())
		}
	}
	return sb.String()
}
