// Research probe: checker-relations-and-inference/groundtruth/zz_relprobe.go.txt plus relEnterAll.
package checker

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
)

// Research probe state. One checker, one goroutine.
var (
	RelTraceOn  bool
	relDepth    int
	relOut      []string
	relKeyBytes = map[CacheHashKey]string{}
	relCounts   = map[string]int{}
	relOrder    []string
)

func relEnter(name string, line int) func() {
	if !RelTraceOn {
		return relNoop
	}
	if _, ok := relCounts[name]; !ok {
		relOrder = append(relOrder, fmt.Sprintf("%s\t%d", name, line))
	}
	relCounts[name]++
	relOut = append(relOut, strings.Repeat("  ", relDepth)+name)
	relDepth++
	return relLeave
}

// RelTraceAll makes the functions outside relater.go and inference.go record their entry too (trace flavour only).
var RelTraceAll bool

func relEnterAll(name string, line int) func() {
	if !RelTraceAll {
		return relNoop
	}
	return relEnter(name, line)
}

func relNoop()  {}
func relLeave() { relDepth-- }

func relNote(format string, args ...any) {
	if RelTraceOn {
		relOut = append(relOut, strings.Repeat("  ", relDepth)+"# "+fmt.Sprintf(format, args...))
	}
}

func relRecordKey(k CacheHashKey, b []byte) CacheHashKey {
	if RelTraceOn {
		relKeyBytes[k] = hex.EncodeToString(b)
	}
	return k
}

func relResultString(r RelationComparisonResult) string {
	var parts []string
	if r&RelationComparisonResultSucceeded != 0 {
		parts = append(parts, "Succeeded")
	}
	if r&RelationComparisonResultFailed != 0 {
		parts = append(parts, "Failed")
	}
	if r&RelationComparisonResultReportsUnmeasurable != 0 {
		parts = append(parts, "ReportsUnmeasurable")
	}
	if r&RelationComparisonResultReportsUnreliable != 0 {
		parts = append(parts, "ReportsUnreliable")
	}
	if r&RelationComparisonResultComplexityOverflow != 0 {
		parts = append(parts, "ComplexityOverflow")
	}
	if len(parts) == 0 {
		return "None"
	}
	return strings.Join(parts, "|")
}

func (c *Checker) relName(r *Relation) string {
	switch r {
	case c.identityRelation:
		return "identity"
	case c.assignableRelation:
		return "assignable"
	case c.comparableRelation:
		return "comparable"
	case c.subtypeRelation:
		return "subtype"
	case c.strictSubtypeRelation:
		return "strictSubtype"
	}
	return "?"
}

var relCurrent *Checker

func relRecordSet(r *Relation, key CacheHashKey, result RelationComparisonResult) {
	if RelTraceOn && relCurrent != nil {
		relOut = append(relOut, strings.Repeat("  ", relDepth)+fmt.Sprintf("# SET %s key=%s result=%s size=%d", relCurrent.relName(r), relKeyBytes[key], relResultString(result), len(r.results)))
	}
}

func ternaryString(t Ternary) string {
	switch t {
	case TernaryFalse:
		return "False"
	case TernaryUnknown:
		return "Unknown"
	case TernaryMaybe:
		return "Maybe"
	case TernaryTrue:
		return "True"
	}
	return fmt.Sprintf("Ternary(%d)", int(t))
}

func relTypeString(t *Type) string {
	if t == nil {
		return "nil"
	}
	return fmt.Sprintf("#%d[%s]", t.id, strings.Join(FormatTypeFlags(t.flags), "|"))
}

// RelProbeStart turns the trace on for one checker.
func RelProbeStart(c *Checker) {
	relCurrent = c
	RelTraceOn = true
}

// RelProbeTrace returns the trace and clears it.
func RelProbeTrace() []string {
	out := relOut
	relOut = nil
	return out
}

// RelProbeFunctions returns the functions entered, in order of first entry, with counts.
func RelProbeFunctions() []string {
	out := make([]string, 0, len(relOrder))
	for _, n := range relOrder {
		name := n[:strings.IndexByte(n, '\t')]
		out = append(out, fmt.Sprintf("%s\t%d", n, relCounts[name]))
	}
	return out
}

// RelProbeSizes returns the size of each relation cache and of the enum relation.
func RelProbeSizes(c *Checker) string {
	return fmt.Sprintf("identity=%d assignable=%d comparable=%d subtype=%d strictSubtype=%d enum=%d types=%d", c.identityRelation.size(), c.assignableRelation.size(), c.comparableRelation.size(), c.subtypeRelation.size(), c.strictSubtypeRelation.size(), len(c.enumRelation), c.TypeCount)
}

// RelProbeCheck runs one relation between the declared types of two variables and reports the result.
func RelProbeCheck(c *Checker, file *ast.SourceFile, relation string, source string, target string) string {
	find := func(name string) *Type {
		s := file.Locals[name]
		if s == nil {
			return nil
		}
		return c.getTypeOfSymbol(s)
	}
	s := find(source)
	t := find(target)
	if s == nil || t == nil {
		return "missing variable"
	}
	var r *Relation
	switch relation {
	case "identity":
		r = c.identityRelation
	case "assignable":
		r = c.assignableRelation
	case "comparable":
		r = c.comparableRelation
	case "subtype":
		r = c.subtypeRelation
	case "strictSubtype":
		r = c.strictSubtypeRelation
	default:
		return "unknown relation"
	}
	ok := c.isTypeRelatedTo(s, t, r)
	return fmt.Sprintf("%s %s(%s) -> %s(%s) = %v", relation, source, c.TypeToString(s), target, c.TypeToString(t), ok)
}

func relChainString(e *ErrorChain) string {
	var parts []string
	for e != nil {
		parts = append(parts, fmt.Sprintf("TS%d%q", e.message.Code(), e.args))
		e = e.next
	}
	return strings.Join(parts, " <- ")
}
