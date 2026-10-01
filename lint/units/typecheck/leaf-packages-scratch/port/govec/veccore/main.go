// Prints what upstream's core functions answer.
// usage: veccore <out dir>     writes pattern.tsv and core.tsv
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"hash/fnv"
	"os"
	"slices"
	"strconv"
	"strings"

	"golden/collections"
	"golden/core"
)

func h(s string) string { return hex.EncodeToString([]byte(s)) }

func b(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

func list(items []string) string {
	hs := make([]string, len(items))
	for i, s := range items {
		hs[i] = h(s)
	}
	return strings.Join(hs, ",")
}

func guarded(f func() string) (result string) {
	defer func() {
		if recover() != nil {
			result = "PANIC"
		}
	}()
	return f()
}

func tri(i int) core.Tristate { return core.Tristate(i) }

func main() {
	dir := os.Args[1]
	pf, err := os.Create(dir + "/pattern.tsv")
	if err != nil {
		panic(err)
	}
	pw := bufio.NewWriter(pf)
	patterns := []string{"", "*", "a", "a*", "*a", "a*b", "a**", "*a*", "foo/*", "foo/*/bar", "@scope/*", "*.ts", "ab*ab", "\u00e9*\u00e9", "a*b*c", "**"}
	candidates := []string{"", "a", "b", "ab", "aa", "aab", "abab", "ababab", "foo/", "foo/x", "foo/x/bar", "foo/bar", "@scope/pkg", "x.ts", ".ts", "\u00e9\u00e9", "\u00e9x\u00e9", "*", "a*"}
	for _, p := range patterns {
		for _, c := range candidates {
			pattern := core.TryParsePattern(p)
			valid := pattern.IsValid()
			fmt.Fprintf(pw, "%s\t%s\t%d %s %s %s\n", h(p), h(c), pattern.StarIndex, b(valid), b(valid && pattern.Matches(c)),
				guarded(func() string { return "=" + h(pattern.MatchedText(c)) }))
		}
	}
	pw.Flush()
	pf.Close()

	cf, err := os.Create(dir + "/core.tsv")
	if err != nil {
		panic(err)
	}
	w := bufio.NewWriter(cf)
	defer func() {
		w.Flush()
		cf.Close()
	}()
	emit := func(label string, value string) { fmt.Fprintf(w, "%s\t%s\n", label, value) }

	for _, name := range []string{"", "a", "a.ts", "a.TS", "a.tsx", "a.d.ts", "a.mts", "a.cts", "a.js", "a.JSX", "a.mjs", "a.cjs", "a.json", "a.JSON", "a.txt", ".ts", "ts", "a.ts.map", "dir.ts/a", "a.\u0130", "a.\xff", "a.TS\u00c9", "a."} {
		kind := core.GetScriptKindFromFileName(name)
		emit("K "+h(name), fmt.Sprintf("%d %d %s %s", kind, core.EnsureScriptKindFromFileName(name), h(core.GetDefaultExtensionForScriptKind(kind)), h(kind.String())))
	}
	for i := -1; i <= 8; i++ {
		emit(fmt.Sprintf("stringer %d", i), strings.Join([]string{
			h(core.ScriptKind(i).String()), h(core.LanguageVariant(i).String()), h(core.GetDefaultExtensionForScriptKind(core.ScriptKind(i))),
			guarded(func() string { return h(core.JsxEmit(i).String()) }), guarded(func() string { return h(core.ModuleResolutionKind(i).String()) }),
			h(core.NewLineKind(i).GetNewLineCharacter()),
		}, " "))
	}
	for _, i := range []int{0, 1, 2, 3, 255} {
		t := core.Tristate(i)
		marshaled, _ := t.MarshalJSON()
		emit(fmt.Sprintf("tristate %d", i), fmt.Sprintf("%s %s%s%s%s%s %d %s", h(t.String()), b(t.IsTrue()), b(t.IsTrueOrUnknown()), b(t.IsFalse()), b(t.IsFalseOrUnknown()), b(t.IsUnknown()), t.DefaultIfUnknown(core.TSTrue), h(string(marshaled))))
	}
	for _, i := range []int{-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 98, 99, 100, 101, 102, 103, 198, 199, 200, 201} {
		m := core.ModuleKind(i)
		emit(fmt.Sprintf("kind %d", i), fmt.Sprintf("%s %s %s%s", h(m.String()), h(core.ScriptTarget(i).String()), b(m.IsNonNodeESM()), b(m.SupportsImportAttributes())))
	}
	for _, s := range []string{"", "\n", "\r\n", "\r", "\n\r"} {
		emit("newline "+h(s), strconv.Itoa(int(core.GetNewLineKind(s))))
	}
	for _, text := range []string{"", "a", "a\nb", "a\r\nb\rc\n", "\n\n", "\r\r\n\n", "a\u2028b\u2029c", "\u00e9\n\U0001F600\r\n\xff\n", "\u0085a\n", "x\xe2\x80", "\xed\xa0\xbd\n\xed\xb8\x80", "no newline at end", "\ufeffa\r"} {
		starts := core.ComputeECMALineStarts(text)
		parts := make([]string, len(starts))
		for i, s := range starts {
			parts[i] = strconv.Itoa(int(s))
		}
		positions := make([]string, 0, 6)
		for _, position := range []int{0, 1, 3, len(text) / 2, len(text), len(text) + 5} {
			line, offset := core.PositionToLineAndByteOffset(position, starts)
			positions = append(positions, fmt.Sprintf("%d:%d", line, offset))
		}
		emit("lines "+h(text), fmt.Sprintf("%s %d %s", strings.Join(parts, ","), core.UTF16Len(text), strings.Join(positions, ",")))
	}
	spell := [][]string{
		{"", "a", "b"}, {"foo", "fop", "foo", "boo", "Foo", "fooo"}, {"length", "lenght", "lengths", "Length", "len", "strength"}, {"ab", "AB", "aB", "ac", "abc"}, {"a", "A", "b"},
		{"getElementById", "getElementsById", "getElementByID", "getElementsByName", "querySelector"}, {"\u00e9t\u00e9", "\u00c9t\u00e9", "ete", "\u00e9t\u00e8"}, {"xyz", "", "xy", "xyzz", "xzy"},
		{"constructor", "construtor", "Constructor", "contructor"}, {"thing", "things", "thin", "think", "THING"}, {"toString", "tostring", "toStrin", "ToString"},
		{"abcdefghij", "abcdefghiX", "abcdefgXij", "Xbcdefghij"}, {"caf\u00e9", "cafe", "CAF\u00c9", "caf\u00e9s"}, {"\xffab", "\xfeab", "ab", "\xffAB"}, {"same", "same"}, {"aaa", "bbb", "ccc"},
	}
	for _, s := range spell {
		for _, max := range []int{0, 1, 2} {
			got := core.GetSpellingSuggestionWithMaxCandidateCount(s[0], slices.Values(s[1:]), core.Identity, strings.Compare, max)
			emit(fmt.Sprintf("spell %d %s %s", max, h(s[0]), list(s[1:])), h(got))
		}
	}
	for _, c := range []struct {
		s, pattern string
		start      int
	}{{"abcabc", "bc", 0}, {"abcabc", "bc", 2}, {"abcabc", "bc", 5}, {"abcabc", "bc", 6}, {"abcabc", "", 3}, {"", "", 0}, {"abc", "x", 0}} {
		emit(fmt.Sprintf("indexafter %s %s %d", h(c.s), h(c.pattern), c.start), strconv.Itoa(core.IndexAfter(c.s, c.pattern, c.start)))
	}
	for a := 0; a < 3; a++ {
		for c := 0; c < 3; c++ {
			o := &core.CompilerOptions{Strict: tri(a), AllowJs: tri(a), CheckJs: tri(c), IsolatedModules: tri(a), VerbatimModuleSyntax: tri(c), PreserveConstEnums: tri(c),
				Incremental: tri(a), Composite: tri(c), Declaration: tri(a), DeclarationMap: tri(c), AllowImportingTsExtensions: tri(a), RewriteRelativeImportExtensions: tri(c),
				ResolvePackageJsonExports: tri(a), ResolvePackageJsonImports: tri(c), ResolveJsonModule: tri(a), UseDefineForClassFields: tri(c)}
			emit(fmt.Sprintf("options %d %d", a, c), strings.Join([]string{
				b(o.GetStrictOptionValue(tri(c))), b(o.GetAllowJS()), b(o.GetIsolatedModules()), b(o.ShouldPreserveConstEnums()), b(o.IsIncremental()), b(o.GetEmitDeclarations()),
				b(o.GetAreDeclarationMapsEnabled()), b(o.GetAllowImportingTsExtensions()), b(o.AllowImportingTsExtensionsFrom("a.d.ts")), b(o.AllowImportingTsExtensionsFrom("a.ts")),
				b(o.GetResolvePackageJsonExports()), b(o.GetResolvePackageJsonImports()), b(o.GetResolveJsonModule()), b(o.GetEmitStandardClassFields()), b(o.GetUseDefineForClassFields()),
				b(core.ShouldRewriteModuleSpecifier("./a.ts", o)), b(core.ShouldRewriteModuleSpecifier("./a.d.ts", o)), b(core.ShouldRewriteModuleSpecifier("a.ts", o)), b(core.ShouldRewriteModuleSpecifier("../a.js", o)),
			}, ""))
		}
	}
	for jsx := 0; jsx <= 6; jsx++ {
		emit(fmt.Sprintf("jsx %d", jsx), b((&core.CompilerOptions{Jsx: core.JsxEmit(jsx)}).GetJSXTransformEnabled()))
	}
	paths := collections.NewOrderedMapFromList([]collections.MapEntry[string, []string]{{Key: "a/*", Value: []string{"b/*"}}})
	empty := &collections.OrderedMap[string, []string]{}
	typeRoots := func(o *core.CompilerOptions, cwd string) string {
		return guarded(func() string {
			roots, fromConfig := o.GetEffectiveTypeRoots(cwd)
			return list(roots) + " " + b(fromConfig)
		})
	}
	emit("misc", strings.Join([]string{
		b((&core.CompilerOptions{}).UsesWildcardTypes()), b((&core.CompilerOptions{Types: []string{}}).UsesWildcardTypes()), b((&core.CompilerOptions{Types: []string{"node", "*"}}).UsesWildcardTypes()),
		h((&core.CompilerOptions{}).GetPathsBasePath("/cwd")), h((&core.CompilerOptions{Paths: empty}).GetPathsBasePath("/cwd")), h((&core.CompilerOptions{Paths: paths}).GetPathsBasePath("/cwd")),
		h((&core.CompilerOptions{Paths: paths, PathsBasePath: "/base"}).GetPathsBasePath("/cwd")),
		typeRoots(&core.CompilerOptions{}, ""), typeRoots(&core.CompilerOptions{}, "/a/b"), typeRoots(&core.CompilerOptions{ConfigFilePath: "c:/x/y/tsconfig.json"}, ""),
		typeRoots(&core.CompilerOptions{TypeRoots: []string{}}, ""), typeRoots(&core.CompilerOptions{TypeRoots: []string{"./types"}, ConfigFilePath: "/p/tsconfig.json"}, "/q"),
	}, " "))

	targets := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99, 100}
	modules := []int{0, 1, 2, 3, 4, 5, 6, 7, 99, 100, 101, 102, 199, 200}
	resolutions := []int{0, 1, 2, 3, 99, 100}
	join := func(values []int) string {
		parts := make([]string, len(values))
		for i, v := range values {
			parts[i] = strconv.Itoa(v)
		}
		return strings.Join(parts, ",")
	}
	emit("grid targets", join(targets))
	emit("grid modules", join(modules))
	emit("grid resolutions", join(resolutions))
	digest := fnv.New64a()
	for _, target := range targets {
		for _, module := range modules {
			for _, resolution := range resolutions {
				for detection := 0; detection <= 3; detection++ {
					o := &core.CompilerOptions{Target: core.ScriptTarget(target), Module: core.ModuleKind(module), ModuleResolution: core.ModuleResolutionKind(resolution), ModuleDetection: core.ModuleDetectionKind(detection)}
					fmt.Fprintf(digest, "%d %d %d %d: %d %d %d %d %s%s%s%s\n", target, module, resolution, detection,
						o.GetEmitScriptTarget(), o.GetEmitModuleKind(), o.GetModuleResolutionKind(), o.GetEmitModuleDetectionKind(),
						b(o.GetResolveJsonModule()), b(o.HasJsonModuleEmitEnabled()), b(o.GetEmitStandardClassFields()), b(o.GetUseDefineForClassFields()))
				}
			}
		}
	}
	emit("grid digest", fmt.Sprintf("%016x", digest.Sum64()))
}
