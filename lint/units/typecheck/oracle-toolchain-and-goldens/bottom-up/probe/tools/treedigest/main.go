// Replay tool: one line of digests per unit from the trees that `tsgoprobe tree` wrote, in the format of
// ts-dump-and-test-importer/top-down/probe/golden.ts (FNV-1a 64 over the named lines, each followed by "\n").
// usage: treedigest [-norelated] <dir of .tsgo.txt> <corpus dir> <manifest.tsv: vname, case, unit name | -> <out.tsv>
// With "-" the units are the files of the corpus dir in byte order, without a case name.
package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var (
	header   = regexp.MustCompile(`^(file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )`)
	fileData = regexp.MustCompile(`^(externalModuleIndicator|usesUriStyleNodeCoreModules|import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective)`)
	nodeLine = regexp.MustCompile(` Kind\w+ \[`)
	related  = regexp.MustCompile(`^(diagnostic|jsDiagnostic|jsdocDiagnostic)\.related `)
)

// The stored digests were made before the tree probe printed the related information of a diagnostic: with
// -norelated those lines are left out, as they were then. Without it they count as tree lines (golden.ts has no
// header pattern for them), which changes the two tree digests of the 31 units that have such a line.
var norelated bool

func fnvLines(lines []string) string {
	h := uint64(0xcbf29ce484222325)
	for _, l := range lines {
		for i := 0; i < len(l); i++ {
			h ^= uint64(l[i])
			h *= 0x100000001b3
		}
		h ^= uint64('\n')
		h *= 0x100000001b3
	}
	return fmt.Sprintf("%016x", h)
}

func fnvBytes(b []byte) string {
	h := uint64(0xcbf29ce484222325)
	for _, c := range b {
		h ^= uint64(c)
		h *= 0x100000001b3
	}
	return fmt.Sprintf("%016x", h)
}

func indent(l string) int { return len(l) - len(strings.TrimLeft(l, " \t")) }

func stripJsdoc(lines []string) []string {
	var out []string
	skip := -1
	for _, l := range lines {
		ind := indent(l)
		if skip >= 0 {
			if ind > skip {
				continue
			}
			skip = -1
		}
		if strings.HasPrefix(l[ind:], ".jsdoc:") {
			skip = ind
			continue
		}
		out = append(out, l)
	}
	return out
}

type unit struct{ vname, caseName, unitName string }

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-norelated" {
		norelated = true
		os.Args = append(os.Args[:1], os.Args[2:]...)
	}
	goOut, corpus, manifest, outFile := os.Args[1], os.Args[2], os.Args[3], os.Args[4]
	var units []unit
	if manifest == "-" {
		entries, err := os.ReadDir(corpus)
		if err != nil {
			panic(err)
		}
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		sort.Strings(names)
		for _, n := range names {
			units = append(units, unit{n, "", n})
		}
	} else {
		b, err := os.ReadFile(manifest)
		if err != nil {
			panic(err)
		}
		for _, l := range strings.Split(string(b), "\n") {
			if l == "" {
				continue
			}
			f := strings.Split(l, "\t")
			units = append(units, unit{f[0], f[1], f[2]})
		}
	}
	out, err := os.Create(outFile)
	if err != nil {
		panic(err)
	}
	w := bufio.NewWriter(out)
	fmt.Fprintln(w, "# case\tunit index\tunit name\tsource bytes\tsource\ttree without jsdoc\ttree\tfile data\tdiagnostics\tjs diagnostics\tnodes without jsdoc\tparse errors\tjsdoc hosts")
	caseIndex := map[string]int{}
	for _, u := range units {
		raw, err := os.ReadFile(filepath.Join(goOut, u.vname+".tsgo.txt"))
		if err != nil {
			panic(err)
		}
		var all []string
		for _, l := range strings.Split(string(raw), "\n") {
			if l != "" && !(norelated && related.MatchString(l)) {
				all = append(all, l)
			}
		}
		src, err := os.ReadFile(filepath.Join(corpus, u.vname))
		if err != nil {
			panic(err)
		}
		if len(src) >= 3 && src[0] == 0xef && src[1] == 0xbb && src[2] == 0xbf {
			src = src[3:]
		}
		var tree, data, diag, jsdiag []string
		for _, l := range all {
			if !header.MatchString(l) {
				tree = append(tree, l)
			}
			if fileData.MatchString(l) {
				data = append(data, l)
			}
			if strings.HasPrefix(l, "diagnostic ") {
				diag = append(diag, l)
			}
			if strings.HasPrefix(l, "jsDiagnostic ") || strings.HasPrefix(l, "jsdocDiagnostic ") {
				jsdiag = append(jsdiag, l)
			}
		}
		noJsdoc := stripJsdoc(tree)
		nodes, hosts := 0, 0
		for _, l := range noJsdoc {
			if nodeLine.MatchString(l) {
				nodes++
			}
		}
		for _, l := range tree {
			if strings.HasPrefix(l[indent(l):], ".jsdoc:") {
				hosts++
			}
		}
		ui := caseIndex[u.caseName]
		caseIndex[u.caseName] = ui + 1
		fmt.Fprintf(w, "%s\t%d\t%s\t%d\t%s\t%s\t%s\t%s\t%s\t%s\t%d\t%d\t%d\n", u.caseName, ui, u.unitName, len(src), fnvBytes(src), fnvLines(noJsdoc), fnvLines(tree), fnvLines(data), fnvLines(diag), fnvLines(jsdiag), nodes, len(diag), hosts)
	}
	w.Flush()
	out.Close()
}
