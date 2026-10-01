package diaggt

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/diagnostics"
	"github.com/microsoft/typescript-go/internal/diagnosticwriter"
	"github.com/microsoft/typescript-go/internal/locale"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/tspath"
)

func unhex(s string) string {
	if s == "-" {
		return ""
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func enhex(s string) string {
	if s == "" {
		return "-"
	}
	return hex.EncodeToString([]byte(s))
}

func atoi(s string) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		panic(err)
	}
	return v
}

// Copied unchanged from internal/compiler/program.go:1597-1637.
func SortAndDeduplicateDiagnostics(diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	diagnostics = slices.Clone(diagnostics)
	slices.SortFunc(diagnostics, ast.CompareDiagnostics)
	return compactAndMergeRelatedInfos(diagnostics)
}

func compactAndMergeRelatedInfos(diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	if len(diagnostics) < 2 {
		return diagnostics
	}
	i := 0
	j := 0
	for i < len(diagnostics) {
		d := diagnostics[i]
		n := 1
		for i+n < len(diagnostics) && ast.EqualDiagnosticsNoRelatedInfo(d, diagnostics[i+n]) {
			n++
		}
		if n > 1 {
			var relatedInfos []*ast.Diagnostic
			for k := range n {
				relatedInfos = append(relatedInfos, diagnostics[i+k].RelatedInformation()...)
			}
			if relatedInfos != nil {
				slices.SortFunc(relatedInfos, ast.CompareDiagnostics)
				relatedInfos = slices.CompactFunc(relatedInfos, ast.EqualDiagnostics)
				d = d.Clone().SetRelatedInfo(relatedInfos)
			}
		}
		diagnostics[j] = d
		i += n
		j++
	}
	clear(diagnostics[j:])
	return diagnostics[:j]
}

var formatOpts = &diagnosticwriter.FormattingOptions{
	NewLine:             "\n",
	ComparePathsOptions: tspath.ComparePathsOptions{CurrentDirectory: "/src", UseCaseSensitiveFileNames: true},
}

func plain(list []*ast.Diagnostic) (out string) {
	defer func() {
		if r := recover(); r != nil {
			out = fmt.Sprintf("PANIC:%v", r)
		}
	}()
	var sb strings.Builder
	diagnosticwriter.WriteFormatDiagnostics(&sb, diagnosticwriter.FromASTDiagnostics(list), formatOpts)
	return sb.String()
}

func pretty(list []*ast.Diagnostic) (out string) {
	defer func() {
		if r := recover(); r != nil {
			out = fmt.Sprintf("PANIC:%v", r)
		}
	}()
	var sb strings.Builder
	diagnosticwriter.FormatDiagnosticsWithColorAndContext(&sb, diagnosticwriter.FromASTDiagnostics(list), formatOpts)
	return sb.String()
}

func format(text string, args []string) (out string) {
	defer func() {
		if r := recover(); r != nil {
			out = fmt.Sprintf("PANIC:%v", r)
		}
	}()
	return diagnostics.Format(text, args)
}

func indexOf(all []*ast.Diagnostic, d *ast.Diagnostic) int {
	for i, x := range all {
		if x == d {
			return i
		}
	}
	return -1
}

func idxList(all []*ast.Diagnostic, list []*ast.Diagnostic) string {
	var parts []string
	for _, d := range list {
		parts = append(parts, strconv.Itoa(indexOf(all, d)))
	}
	if len(parts) == 0 {
		return "-"
	}
	return strings.Join(parts, ",")
}

func Main() {
	w := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer w.Flush()
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	var files []*ast.SourceFile
	var all []*ast.Diagnostic
	var top []*ast.Diagnostic
	name := ""
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, " ")
		switch f[0] {
		case "F":
			fileName := unhex(f[1])
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: fileName, Path: tspath.Path(fileName)}, unhex(f[2]), core.ScriptKindTS)
			files = append(files, file)
		case "CASE":
			name = f[1]
			all = nil
			top = nil
		case "D":
			var file *ast.SourceFile
			if fi := atoi(f[1]); fi >= 0 {
				file = files[fi]
			}
			loc := core.NewTextRange(atoi(f[2]), atoi(f[3]))
			msg := byCode[int32(atoi(f[4]))]
			if msg == nil {
				panic("unknown code " + f[4])
			}
			n := atoi(f[7])
			var args []any
			for i := 0; i < n; i++ {
				a := f[8+i]
				if strings.HasPrefix(a, "s:") {
					args = append(args, unhex(a[2:]))
				} else {
					args = append(args, atoi(a[2:]))
				}
			}
			d := ast.NewDiagnostic(file, loc, msg, args...)
			if c := atoi(f[5]); c >= 0 {
				d.SetCategory(diagnostics.Category(c))
			}
			if f[6] == "1" {
				d.SetSkippedOnNoEmit()
			}
			all = append(all, d)
		case "A":
			var file *ast.SourceFile
			if fi := atoi(f[2]); fi >= 0 {
				file = files[fi]
			}
			d := ast.NewDiagnostic(file, core.NewTextRange(atoi(f[3]), atoi(f[4])), diagnostics.NewAdHocMessage(unhex(f[1])))
			all = append(all, d)
		case "X":
			var file *ast.SourceFile
			if fi := atoi(f[1]); fi >= 0 {
				file = files[fi]
			}
			all = append(all, ast.NewExternalDiagnostic(file, core.NewTextRange(atoi(f[2]), atoi(f[3])), unhex(f[4]), diagnostics.Category(atoi(f[5])), int32(atoi(f[6])), unhex(f[7])))
		case "KEY":
			var key string
			if m := byCode[int32(atoi(f[1]))]; m != nil {
				key = string(m.Key())
			}
			fmt.Fprintf(w, "KEY %s %s\n", f[1], key)
		case "N":
			var chain *ast.Diagnostic
			if ci := atoi(f[1]); ci >= 0 {
				chain = all[ci]
			}
			msg := byCode[int32(atoi(f[2]))]
			n := atoi(f[3])
			var args []any
			for i := 0; i < n; i++ {
				a := f[4+i]
				if strings.HasPrefix(a, "s:") {
					args = append(args, unhex(a[2:]))
				} else {
					args = append(args, atoi(a[2:]))
				}
			}
			all = append(all, ast.NewDiagnosticChain(chain, msg, args...))
		case "CL":
			suggestion := *all[atoi(f[1])]
			suggestion.SetCategory(diagnostics.Category(atoi(f[2])))
			all = append(all, &suggestion)
		case "REL":
			fmt.Fprintf(w, "REL %s\n", enhex(tspath.ConvertToRelativePath(unhex(f[3]), tspath.ComparePathsOptions{CurrentDirectory: unhex(f[1]), UseCaseSensitiveFileNames: f[2] == "1"})))
		case "C":
			all[atoi(f[1])].AddMessageChain(all[atoi(f[2])])
		case "R":
			all[atoi(f[1])].AddRelatedInfo(all[atoi(f[2])])
		case "TOP":
			for _, s := range f[1:] {
				top = append(top, all[atoi(s)])
			}
		case "END":
			fmt.Fprintf(w, "CASE %s\n", name)
			var cmp, eq, eqn strings.Builder
			for _, a := range all {
				for _, b := range all {
					c := ast.CompareDiagnostics(a, b)
					switch {
					case c < 0:
						cmp.WriteByte('<')
					case c > 0:
						cmp.WriteByte('>')
					default:
						cmp.WriteByte('=')
					}
					if ast.EqualDiagnostics(a, b) {
						eq.WriteByte('1')
					} else {
						eq.WriteByte('0')
					}
					if ast.EqualDiagnosticsNoRelatedInfo(a, b) {
						eqn.WriteByte('1')
					} else {
						eqn.WriteByte('0')
					}
				}
			}
			fmt.Fprintf(w, "CMP %s\nEQ %s\nEQN %s\n", cmp.String(), eq.String(), eqn.String())
			for i, d := range all {
				fmt.Fprintf(w, "FLAT %d %s\n", i, enhex(diagnosticwriter.FlattenDiagnosticMessage(diagnosticwriter.WrapASTDiagnostic(d), "\n", locale.Default)))
			}
			var coll ast.DiagnosticsCollection
			var added []string
			for _, d := range top {
				added = append(added, strconv.Itoa(indexOf(all, coll.Add(d))))
			}
			fmt.Fprintf(w, "ADD %s\n", strings.Join(added, ","))
			for i, file := range files {
				fmt.Fprintf(w, "FILEDIAGS %d %s\n", i, idxList(all, coll.GetDiagnosticsForFile(file)))
			}
			fmt.Fprintf(w, "GLOBAL %s\n", idxList(all, coll.GetGlobalDiagnostics()))
			fmt.Fprintf(w, "ALL %s\n", idxList(all, coll.GetDiagnostics()))
			var looked []*ast.Diagnostic
			for _, d := range all {
				looked = append(looked, coll.Lookup(d))
			}
			fmt.Fprintf(w, "LOOKUP %s\n", idxList(all, looked))
			var props []string
			for _, d := range all {
				props = append(props, fmt.Sprintf("%d:%d:%d:%d:%d:%d:%d", d.Pos(), d.End(), d.Code(), d.Category(), len(d.MessageChain()), len(d.RelatedInformation()), core.IfElse(d.File() == nil, -1, slices.Index(files, d.File()))))
			}
			fmt.Fprintf(w, "PROPS %s\n", strings.Join(props, " "))
			stable := slices.Clone(top)
			slices.SortStableFunc(stable, ast.CompareDiagnostics)
			fmt.Fprintf(w, "STABLE %s\n", idxList(all, stable))
			unstable := slices.Clone(top)
			slices.SortFunc(unstable, ast.CompareDiagnostics)
			fmt.Fprintf(w, "UNSTABLE %s\n", idxList(all, unstable))
			sorted := SortAndDeduplicateDiagnostics(top)
			fmt.Fprintf(w, "SORTEDIDX %s\n", idxList(all, sorted))
			fmt.Fprintf(w, "SORTED %s\n", enhex(plain(sorted)))
			fmt.Fprintf(w, "PLAINTOP %s\n", enhex(plain(top)))
			fmt.Fprintf(w, "PRETTY %s\n", enhex(pretty(sorted)))
			fmt.Fprintf(w, "END\n")
		case "FMT":
			n := atoi(f[2])
			var args []string
			for i := 0; i < n; i++ {
				args = append(args, unhex(f[3+i]))
			}
			fmt.Fprintf(w, "FMT %s\n", enhex(format(unhex(f[1]), args)))
		case "SORT":
			div := atoi(f[1])
			var xs []int
			for _, t := range f[2:] {
				xs = append(xs, atoi(t))
			}
			cmpf := func(a, b int) int { return a/div - b/div }
			u := slices.Clone(xs)
			slices.SortFunc(u, cmpf)
			st := slices.Clone(xs)
			slices.SortStableFunc(st, cmpf)
			var us, ss []string
			for _, v := range u {
				us = append(us, strconv.Itoa(v))
			}
			for _, v := range st {
				ss = append(ss, strconv.Itoa(v))
			}
			var bs []string
			for _, probe := range []int{-5, 0, 7, 16, 100, 1000, 100000} {
				i, ok := slices.BinarySearchFunc(st, probe, cmpf)
				bs = append(bs, fmt.Sprintf("%d:%v", i, ok))
			}
			fmt.Fprintf(w, "SORT %s | %s | %s\n", strings.Join(us, ","), strings.Join(ss, ","), strings.Join(bs, ","))
		case "LINECOL":
			file := files[atoi(f[1])]
			d := ast.NewDiagnostic(file, core.NewTextRange(atoi(f[2]), atoi(f[2])), diagnostics.Identifier_expected)
			fmt.Fprintf(w, "LINECOL %s\n", enhex(plain([]*ast.Diagnostic{d})))
		}
	}
}
