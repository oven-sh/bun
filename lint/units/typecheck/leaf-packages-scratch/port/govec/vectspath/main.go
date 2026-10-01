// Prints what upstream's tspath functions answer.
// usage: vectspath <out file> [file for every line]
// Line kinds: "S" a path; "D1" the FNV-1a digest of the "1" lines of the paths, each a path and the answers of every
// one-argument function; "I" an input of the pair digest; "D" the FNV-1a digest of the "2" lines of every ordered pair
// of inputs; "3" CombinePaths and ResolvePath of three paths; "P" GetCommonParents. A string is hex, a list is its hex
// strings joined by commas, fields are joined by "|". The second file has the "1" and "2" lines themselves.
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"hash/fnv"
	"os"
	"sort"
	"strconv"
	"strings"

	"golden/tspath"
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

func extractStrings(file string) []string {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, file, nil, 0)
	if err != nil {
		panic(err)
	}
	var out []string
	ast.Inspect(f, func(n ast.Node) bool {
		if bl, ok := n.(*ast.BasicLit); ok && bl.Kind == token.STRING {
			if s, err := strconv.Unquote(bl.Value); err == nil {
				out = append(out, s)
			}
		}
		return true
	})
	return out
}

func ancestors(p string) []string {
	var seen []string
	tspath.ForEachAncestorDirectory(p, func(dir string) (any, bool) {
		seen = append(seen, dir)
		return nil, len(seen) >= 50
	})
	return seen
}

func one(p string) string {
	f := []string{
		b(tspath.IsUrl(p)), b(tspath.IsRootedDiskPath(p)), b(tspath.IsDiskPathRoot(p)), b(tspath.IsDynamicFileName(p)), b(tspath.PathIsAbsolute(p)),
		b(tspath.HasTrailingDirectorySeparator(p)), strconv.Itoa(tspath.GetEncodedRootLength(p)), strconv.Itoa(tspath.GetRootLength(p)),
		h(tspath.GetDirectoryPath(p)), h(tspath.NormalizeSlashes(p)), h(tspath.NormalizePath(p)), h(tspath.GetBaseFileName(p)),
		h(tspath.GetAnyExtensionFromPath(p, nil, false)), h(tspath.RemoveTrailingDirectorySeparator(p)), h(tspath.RemoveTrailingDirectorySeparators(p)),
		h(tspath.EnsureTrailingDirectorySeparator(p)), b(tspath.PathIsRelative(p)), h(tspath.EnsurePathIsNonModuleName(p)),
		b(tspath.IsExternalModuleNameRelative(p)), h(tspath.ToFileNameLowerCase(p)), b(tspath.HasExtension(p)),
	}
	volume, rest, ok := tspath.SplitVolumePath(p)
	f = append(f, h(volume), h(rest), b(ok))
	f = append(f, list(tspath.GetPathComponents(p, "")), list(tspath.GetNormalizedPathComponents(p, "")),
		h(tspath.GetPathFromPathComponents(tspath.GetPathComponents(p, ""))), h(tspath.ResolvePath(p)), h(tspath.GetNormalizedAbsolutePath(p, "")),
		list(ancestors(p)),
		h(string(tspath.Path(p).GetDirectoryPath())), h(string(tspath.Path(p).RemoveTrailingDirectorySeparator())), h(string(tspath.Path(p).EnsureTrailingDirectorySeparator())),
		b(tspath.ExtensionIsTs(p)), h(tspath.RemoveFileExtension(p)), h(tspath.RemoveAnyFileExtension(p)), h(tspath.TryGetExtensionFromPath(p)), h(tspath.TryExtractTSExtension(p)),
		b(tspath.HasTSFileExtension(p)), b(tspath.HasImplementationTSFileExtension(p)), b(tspath.HasJSFileExtension(p)), b(tspath.HasJSONFileExtension(p)), b(tspath.IsDeclarationFileName(p)),
		h(tspath.GetDeclarationFileExtension(p)), h(tspath.GetDeclarationEmitExtensionForPath(p)),
		h(tspath.ChangeExtension(p, ".js")), h(tspath.ChangeExtension(p, "mjs")), h(tspath.ChangeExtension(p, "")), h(tspath.ChangeFullExtension(p, ".js")), h(tspath.ChangeFullExtension(p, "cjs")),
		list(tspath.GetPossibleOriginalInputExtensionForExtension(p)),
		b(tspath.FileExtensionIsOneOf(p, []string{".ts", ".tsx"})), b(tspath.ExtensionIsOneOf(p, []string{".ts", ".js"})),
		h(tspath.ChangeAnyExtension(p, ".x", []string{".ts", ".JS"}, true)), h(tspath.ChangeAnyExtension(p, ".x", []string{".ts", ".JS"}, false)),
		h(tspath.GetAnyExtensionFromPath(p, []string{"ts", ".JS", ".d.ts"}, true)), h(tspath.GetAnyExtensionFromPath(p, []string{"ts", ".JS", ".d.ts"}, false)),
		h(tspath.GetLongestExtensionFromPath(p, []string{".ts", ".d.ts", "json"}, true)),
	)
	return strings.Join(f, "|")
}

func guarded(f func() string) (result string) {
	defer func() {
		if recover() != nil {
			result = "PANIC"
		}
	}()
	return f()
}

func two(a, c string) string {
	cs := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true}
	ci := tspath.ComparePathsOptions{}
	base := tspath.ComparePathsOptions{CurrentDirectory: "/base"}
	var visited []string
	tspath.ForEachAncestorDirectoryStoppingAtGlobalCache(c, a, func(dir string) (string, bool) {
		visited = append(visited, dir)
		return "", len(visited) >= 50
	})
	restCs, okCs := tspath.TrimFilePathPrefix(a, c, true)
	restCi, okCi := tspath.TrimFilePathPrefix(a, c, false)
	f := []string{
		h(tspath.CombinePaths(a, c)), h(tspath.ResolvePath(a, c)), h(tspath.GetNormalizedAbsolutePath(a, c)), h(tspath.GetNormalizedAbsolutePathWithoutRoot(a, c)),
		list(tspath.GetPathComponents(a, c)), list(tspath.GetNormalizedPathComponents(a, c)), h(tspath.ResolveTripleslashReference(a, c)),
		h(string(tspath.ToPath(a, c, true))), h(string(tspath.ToPath(a, c, false))),
		strconv.Itoa(tspath.ComparePaths(a, c, cs)), strconv.Itoa(tspath.ComparePaths(a, c, ci)), strconv.Itoa(tspath.ComparePathsCaseSensitive(a, c, "/base")), strconv.Itoa(tspath.ComparePathsCaseInsensitive(a, c, "/base")),
		b(tspath.ContainsPath(a, c, cs)), b(tspath.ContainsPath(a, c, ci)), b(tspath.ContainsPath(a, c, base)),
		guarded(func() string { return h(tspath.GetRelativePathFromDirectory(a, c, cs)) }), guarded(func() string { return h(tspath.GetRelativePathFromDirectory(a, c, ci)) }),
		guarded(func() string { return h(tspath.GetRelativePathFromFile(a, c, ci)) }),
		h(tspath.ConvertToRelativePath(a, tspath.ComparePathsOptions{CurrentDirectory: c})),
		h(tspath.GetRelativePathToDirectoryOrUrl(a, c, false, ci)), h(tspath.GetRelativePathToDirectoryOrUrl(a, c, true, ci)),
		b(tspath.StartsWithDirectory(a, c, true)), b(tspath.StartsWithDirectory(a, c, false)),
		h(restCs), b(okCs), h(restCi), b(okCi),
		b(tspath.FileExtensionIs(a, c)), strconv.Itoa(tspath.CompareNumberOfDirectorySeparators(a, c)), b(tspath.Path(a).ContainsPath(tspath.Path(c))),
		h(tspath.GetAnyExtensionFromPath(a, []string{c}, true)), list(visited), list(tspath.GetPathComponentsRelativeTo(a, c, ci)),
	}
	return strings.Join(f, "|")
}

func commonParents(paths []string, minComponents int, caseSensitive bool) string {
	return guarded(func() string {
		parents, ignored := tspath.GetCommonParents(paths, minComponents, tspath.GetPathComponents, tspath.ComparePathsOptions{UseCaseSensitiveFileNames: caseSensitive})
		keys := make([]string, 0, len(ignored))
		for k := range ignored {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		return list(parents) + ";" + list(keys)
	})
}

func main() {
	out, err := os.Create(os.Args[1])
	if err != nil {
		panic(err)
	}
	w := bufio.NewWriter(out)
	full := bufio.NewWriter(os.Stderr)
	if len(os.Args) > 2 {
		fullFile, err := os.Create(os.Args[2])
		if err != nil {
			panic(err)
		}
		defer fullFile.Close()
		full = bufio.NewWriter(fullFile)
	}
	defer func() {
		w.Flush()
		out.Close()
		if len(os.Args) > 2 {
			full.Flush()
		}
	}()
	root := "/workspace/ref/typescript-go/internal/tspath/"
	seen := map[string]bool{}
	var singles []string
	add := func(s string) {
		if !seen[s] && len(s) <= 64 {
			seen[s] = true
			singles = append(singles, s)
		}
	}
	for _, f := range []string{"path_test.go", "startsWithDirectory_test.go", "untitled_test.go"} {
		for _, s := range extractStrings(root + f) {
			add(s)
		}
	}
	for _, s := range []string{
		"", "/", "//", "///", "\\", "\\\\", "c:", "c:/", "c:\\", "C:\\Foo\\Bar.TS", "c:d", "1:/x", "^/untitled/ts-nul-authority/Untitled-1", "^/", "^",
		"file://", "file:///", "file:///c:", "file:///c:/", "file:///c%3a/x", "file:///c%3A", "file:///c%3ad", "file://localhost/c:/a", "file://server/c:/a", "http://a.b/c/d.ts?x#y", "://", "a://", "a:/b",
		"a", "a/", "a/b/c.d.ts", "a/./b", "a/../b", "../a", "./a", ".", "..", "./", "../", ".\\a", "..\\a", "a/..", "a/.", "/..", "/../..", "/a/../..", "a//b", "/a//b/", "a/b/../../..", "/./a", "./../a", "./a/./b/../c/",
		"x.ts", "x.tsx", "x.d.ts", "x.d.mts", "x.d.cts", "x.mts", "x.cts", "x.js", "x.jsx", "x.mjs", "x.cjs", "x.json", "x.d.json.ts", "x.d.css.ts", "x.tsbuildinfo", ".ts", ".d.ts", "d.ts", "x.TS", "x.ts/", "x.min.js", "x.", "x", "/a.b/c", "/a/b.c.d", "a.d.ts.map", ".d.", ".d.x.ts", "x.d.",
		"\u0130stanbul/I\u0307.TS", "\u212aelvin/\u00c9.ts", "a\xffb/\xc3.ts", "Stra\u00dfe/\u1e9e", "/\u4e2d\u6587/\U0001F600.d.ts", "C:/\u00c4/b", "/node_modules/.pnpm/x", "/a/.git/b",
	} {
		add(s)
	}
	skipped := 0
	digest1 := fnv.New64a()
	for _, p := range singles {
		r := guarded(func() string { return one(p) })
		if r == "PANIC" {
			skipped++
			fmt.Fprintf(os.Stderr, "one-argument panic: %q\n", p)
			continue
		}
		fmt.Fprintf(w, "S\t%s\n", h(p))
		fmt.Fprintf(digest1, "1\t%s\t%s\n", h(p), r)
		if len(os.Args) > 2 {
			fmt.Fprintf(full, "1\t%s\t%s\n", h(p), r)
		}
	}
	fmt.Fprintf(w, "D1\t%016x\n", digest1.Sum64())
	pairs := []string{
		"", "/", "/a", "/a/", "/a/b", "/a/b/c.ts", "/A/B", "/a/b/../c", "/a/./b/", "a", "a/b", "./a", "../a", "..", ".", "a/../../b", "c:/", "c:/a", "C:/A/b", "d:/a", "c:", "//server/share", "//server/share/x",
		"file:///a/b", "file:///c:/a", "http://x.y/a", "http://x.y", "\\a\\b", "a\\b", ".ts", "x.ts", "/a/b/x.D.TS", "/\u0130/b", "/i\u0307/B", "/\u212a/x", "/k/X", "^/untitled/x", "/a/b/", "/base", "/base/a", "/a/bc", "/a/b//", "/\xff/a",
	}
	digest := fnv.New64a()
	for _, p := range pairs {
		fmt.Fprintf(w, "I\t%s\n", h(p))
	}
	for _, a := range pairs {
		for _, c := range pairs {
			r := guarded(func() string { return two(a, c) })
			if r == "PANIC" {
				fmt.Fprintf(os.Stderr, "two-argument panic: %q %q\n", a, c)
			}
			fmt.Fprintf(digest, "2\t%s\t%s\t%s\n", h(a), h(c), r)
			if len(os.Args) > 2 {
				fmt.Fprintf(full, "2\t%s\t%s\t%s\n", h(a), h(c), r)
			}
		}
	}
	fmt.Fprintf(w, "D\t%016x\n", digest.Sum64())
	triples := [][3]string{
		{"path", "to", "file.ext"}, {"path", "dir", ".."}, {"/path", "/to", "file.ext"}, {"c:/path", "c:/to", "file.ext"}, {"file:///path", "file:///to", "file.ext"},
		{"", "", ""}, {"", "a", ""}, {"a", "", "b"}, {"a/", "b/", "c/"}, {"a\\b", "c\\d", "..\\e"}, {"/a", "..", ".."}, {"a", "b", "/c"}, {"/", "node_modules", "@types"}, {"c:", "a", "b"}, {"", "", "/"},
	}
	for _, t := range triples {
		fmt.Fprintf(w, "3\t%s\t%s\t%s\t%s|%s\n", h(t[0]), h(t[1]), h(t[2]), h(tspath.CombinePaths(t[0], t[1], t[2])), h(tspath.ResolvePath(t[0], t[1], t[2])))
	}
	parents := []struct {
		min   int
		paths []string
	}{
		{1, nil}, {1, []string{"/a/b/c/d"}}, {4, []string{"/a/b/c/d", "/a/b/c/e", "/a/b/f/g", "/x/y"}}, {1, []string{"/a/b/c/d", "/a/b/c/e", "/a/b/f/g"}},
		{1, []string{"/a/b/c/d", "/a/b/c/e", "/a/b/f/g", "/x/y/z"}}, {3, []string{"/a/b/c/d", "/a/b/c/e", "/a/b/f/g", "/x/y/z"}}, {1, []string{"c:/a/b/c/d", "d:/a/b/c/d"}},
		{1, []string{"/a/b/c/d", "/a/b/c/d"}}, {2, []string{"/a/b/c/d", "/x/y"}}, {2, []string{"/a/b/c/d", "/a/z/c/e", "/a/aaa/f/g", "/x/y/z"}}, {1, []string{"/a/b/", "/a/b/c"}},
		{0, []string{"/a"}}, {5, []string{"/a/b"}}, {2, []string{"/A/b/c", "/a/B/d"}}, {2, []string{"a/b", "a/c", "d"}},
	}
	for _, p := range parents {
		for _, caseSensitive := range []bool{false, true} {
			fmt.Fprintf(w, "P\t%d\t%s\t%s\t%s\n", p.min, b(caseSensitive), list(p.paths), commonParents(p.paths, p.min, caseSensitive))
		}
	}
	fmt.Fprintf(os.Stderr, "singles %d (skipped %d) pairs %d\n", len(singles)-skipped, skipped, len(pairs))
}
