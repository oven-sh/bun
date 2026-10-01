// Ground truth for instance materialisation: the reference's own path functions, glob matcher and in-memory
// file system (verbatim copies under internal/), driven by vectors. Standard library only.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/microsoft/typescript-go/internal/tspath"
	"github.com/microsoft/typescript-go/internal/vfs"
	"github.com/microsoft/typescript-go/internal/vfs/vfsmatch"
	"github.com/microsoft/typescript-go/internal/vfs/vfstest"
)

type pathVector struct {
	A string `json:"a"`
	B string `json:"b"`
}

type pathResult struct {
	A                          string   `json:"a"`
	B                          string   `json:"b"`
	RootLength                 int      `json:"rootLength"`
	IsRooted                   bool     `json:"isRooted"`
	NormalizedAbsolute         string   `json:"normalizedAbsolute"`
	NormalizePath              string   `json:"normalizePath"`
	Combine                    string   `json:"combine"`
	Directory                  string   `json:"directory"`
	Base                       string   `json:"base"`
	AnyExtension               string   `json:"anyExtension"`
	HasExtension               bool     `json:"hasExtension"`
	NormalizedComponents       []string `json:"normalizedComponents"`
	PathComponents             []string `json:"pathComponents"`
	FromComponents             string   `json:"fromComponents"`
	ContainsSensitive          bool     `json:"containsSensitive"`
	ContainsInsensitive        bool     `json:"containsInsensitive"`
	RelativeSensitive          string   `json:"relativeSensitive"`
	RelativeInsensitive        string   `json:"relativeInsensitive"`
	ToPathSensitive            string   `json:"toPathSensitive"`
	ToPathInsensitive          string   `json:"toPathInsensitive"`
	ChangeExtensionJs          string   `json:"changeExtensionJs"`
	IsDts                      bool     `json:"isDts"`
	IsJson                     bool     `json:"isJson"`
	IsTsBuildInfo              bool     `json:"isTsBuildInfo"`
	CompareSensitive           int      `json:"compareSensitive"`
	CompareInsensitive         int      `json:"compareInsensitive"`
	RemoveTrailing             string   `json:"removeTrailing"`
	EnsureTrailing             string   `json:"ensureTrailing"`
	Panic                      string   `json:"panic,omitempty"`
}

type matchVector struct {
	Name     string            `json:"name"`
	Files    []string          `json:"files"`
	Symlinks map[string]string `json:"symlinks"`
	Ucsfn    bool              `json:"ucsfn"`
	BasePath string            `json:"basePath"`
	FileSpec []string          `json:"fileSpec"`
	Includes []string          `json:"includes"`
	Excludes []string          `json:"excludes"`
	AllowJs  bool              `json:"allowJs"`
	Json     bool              `json:"json"`
}

type matchResult struct {
	Name      string   `json:"name"`
	Panic     string   `json:"panic,omitempty"`
	Read      []string `json:"read"`
	FileNames []string `json:"fileNames"`
	Entries   []string `json:"entries"`
}

type vectors struct {
	Paths []pathVector  `json:"paths"`
	Match []matchVector `json:"match"`
}

type results struct {
	Paths []pathResult  `json:"paths"`
	Match []matchResult `json:"match"`
}

// A map that keeps insertion order, with the methods of collections.OrderedMap that the copy below calls.
type orderedMap struct {
	keys   []string
	values map[string]string
}

func (m *orderedMap) Set(k string, v string) {
	if m.values == nil {
		m.values = map[string]string{}
	}
	if _, ok := m.values[k]; !ok {
		m.keys = append(m.keys, k)
	}
	m.values[k] = v
}

func (m *orderedMap) Has(k string) bool {
	_, ok := m.values[k]
	return ok
}

func (m *orderedMap) Delete(k string) {
	if _, ok := m.values[k]; !ok {
		return
	}
	delete(m.values, k)
	m.keys = slices.DeleteFunc(m.keys, func(x string) bool { return x == k })
}

func (m *orderedMap) Size() int { return len(m.keys) }

func (m *orderedMap) Values() []string {
	out := make([]string, 0, len(m.keys))
	for _, k := range m.keys {
		out = append(out, m.values[k])
	}
	return out
}

// ---- internal/tsoptions/tsconfigparsing.go:1869-1899 (verbatim) ----
func hasFileWithHigherPriorityExtension(file string, extensions [][]string, hasFile func(fileName string) bool) bool {
	var extensionGroup []string
	for _, group := range extensions {
		if tspath.FileExtensionIsOneOf(file, group) {
			extensionGroup = append(extensionGroup, group...)
		}
	}
	if len(extensionGroup) == 0 {
		return false
	}
	for _, ext := range extensionGroup {
		// d.ts files match with .ts extension and with case sensitive sorting the file order for same files with ts tsx and dts extension is
		// d.ts, .ts, .tsx in that order so we need to handle tsx and dts of same same name case here and in remove files with same extensions
		// So dont match .d.ts files with .ts extension
		if tspath.FileExtensionIs(file, ext) && (ext != tspath.ExtensionTs || !tspath.FileExtensionIs(file, tspath.ExtensionDts)) {
			return false
		}
		if hasFile(tspath.ChangeExtension(file, ext)) {
			if ext == tspath.ExtensionDts && (tspath.FileExtensionIs(file, tspath.ExtensionJs) || tspath.FileExtensionIs(file, tspath.ExtensionJsx)) {
				// LEGACY BEHAVIOR: An off-by-one bug somewhere in the extension priority system for wildcard module loading allowed declaration
				// files to be loaded alongside their js(x) counterparts. We regard this as generally undesirable, but retain the behavior to
				// prevent breakage.
				continue
			}
			return true
		}
	}
	return false
}

// ---- internal/tsoptions/tsconfigparsing.go:1901-1919 (the map type replaced) ----
func removeWildcardFilesWithLowerPriorityExtension(file string, wildcardFiles *orderedMap, extensions [][]string, keyMapper func(value string) string) {
	var extensionGroup []string
	for _, group := range extensions {
		if tspath.FileExtensionIsOneOf(file, group) {
			extensionGroup = append(extensionGroup, group...)
		}
	}
	if extensionGroup == nil {
		return
	}
	for i := len(extensionGroup) - 1; i >= 0; i-- {
		ext := extensionGroup[i]
		if tspath.FileExtensionIs(file, ext) {
			return
		}
		lowerPriorityPath := keyMapper(tspath.ChangeExtension(file, ext))
		wildcardFiles.Delete(lowerPriorityPath)
	}
}

func flatten(a [][]string) []string {
	var out []string
	for _, g := range a {
		out = append(out, g...)
	}
	return out
}

// ---- internal/tsoptions/tsconfigparsing.go:1928-2018 (the options become two flags, the map type is replaced) ----
func getFileNamesFromConfigSpecs(
	validatedFilesSpec []string,
	validatedIncludeSpecs []string,
	validatedExcludeSpecs []string,
	basePath string,
	allowJs bool,
	resolveJsonModule bool,
	host vfs.FS,
) ([]string, []string) {
	basePath = tspath.NormalizePath(basePath)
	keyMappper := func(value string) string { return tspath.GetCanonicalFileName(value, host.UseCaseSensitiveFileNames()) }
	var literalFileMap orderedMap
	var wildcardFileMap orderedMap
	var wildCardJsonFileMap orderedMap
	var supportedExtensions [][]string
	if allowJs {
		supportedExtensions = tspath.AllSupportedExtensions
	} else {
		supportedExtensions = tspath.SupportedTSExtensions
	}
	supportedExtensionsWithJsonIfResolveJsonModule := supportedExtensions
	if resolveJsonModule {
		if allowJs {
			supportedExtensionsWithJsonIfResolveJsonModule = tspath.AllSupportedExtensionsWithJson
		} else {
			supportedExtensionsWithJsonIfResolveJsonModule = tspath.SupportedTSExtensionsWithJson
		}
	}
	for _, fileName := range validatedFilesSpec {
		file := tspath.GetNormalizedAbsolutePath(fileName, basePath)
		literalFileMap.Set(keyMappper(fileName), file)
	}

	var read []string
	var jsonOnlyIncludeMatchers *vfsmatch.SpecMatcher
	if len(validatedIncludeSpecs) > 0 {
		files := vfsmatch.ReadDirectory(host, basePath, basePath, flatten(supportedExtensionsWithJsonIfResolveJsonModule), validatedExcludeSpecs, validatedIncludeSpecs, vfsmatch.UnlimitedDepth)
		read = files
		for _, file := range files {
			if tspath.FileExtensionIs(file, tspath.ExtensionJson) {
				if jsonOnlyIncludeMatchers == nil {
					var includes []string
					for _, include := range validatedIncludeSpecs {
						if strings.HasSuffix(include, tspath.ExtensionJson) {
							includes = append(includes, include)
						}
					}
					jsonOnlyIncludeMatchers = vfsmatch.NewSpecMatcher(includes, basePath, vfsmatch.UsageFiles, host.UseCaseSensitiveFileNames())
				}
				var includeIndex int = -1
				if jsonOnlyIncludeMatchers != nil {
					includeIndex = jsonOnlyIncludeMatchers.MatchIndex(file)
				}
				if includeIndex != -1 {
					key := keyMappper(file)
					if !literalFileMap.Has(key) && !wildCardJsonFileMap.Has(key) {
						wildCardJsonFileMap.Set(key, file)
					}
				}
				continue
			}
			if hasFileWithHigherPriorityExtension(file, supportedExtensions, func(fileName string) bool {
				canonicalFileName := keyMappper(fileName)
				return literalFileMap.Has(canonicalFileName) || wildcardFileMap.Has(canonicalFileName)
			}) {
				continue
			}
			removeWildcardFilesWithLowerPriorityExtension(file, &wildcardFileMap, supportedExtensions, keyMappper)
			key := keyMappper(file)
			if !literalFileMap.Has(key) && !wildcardFileMap.Has(key) {
				wildcardFileMap.Set(key, file)
			}
		}
	}
	files := make([]string, 0, literalFileMap.Size()+wildcardFileMap.Size()+wildCardJsonFileMap.Size())
	files = append(files, literalFileMap.Values()...)
	files = append(files, wildcardFileMap.Values()...)
	files = append(files, wildCardJsonFileMap.Values()...)
	return files, read
}

func guard(f func()) (p string) {
	defer func() {
		if r := recover(); r != nil {
			p = fmt.Sprint(r)
		}
	}()
	f()
	return ""
}

func runPath(v pathVector) (r pathResult) {
	r.A, r.B = v.A, v.B
	r.Panic = guard(func() {
		a, b := v.A, v.B
		r.RootLength = tspath.GetRootLength(a)
		r.IsRooted = tspath.IsRootedDiskPath(a)
		r.NormalizedAbsolute = tspath.GetNormalizedAbsolutePath(a, b)
		r.NormalizePath = tspath.NormalizePath(a)
		r.Combine = tspath.CombinePaths(b, a)
		r.Directory = tspath.GetDirectoryPath(a)
		r.Base = tspath.GetBaseFileName(a)
		r.AnyExtension = tspath.GetAnyExtensionFromPath(a, nil, false)
		r.HasExtension = tspath.HasExtension(a)
		r.NormalizedComponents = tspath.GetNormalizedPathComponents(a, b)
		r.PathComponents = tspath.GetPathComponents(a, b)
		r.FromComponents = tspath.GetPathFromPathComponents(tspath.GetNormalizedPathComponents(a, b))
		r.ContainsSensitive = tspath.ContainsPath(b, a, tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true})
		r.ContainsInsensitive = tspath.ContainsPath(b, a, tspath.ComparePathsOptions{UseCaseSensitiveFileNames: false})
		r.RelativeSensitive = tspath.ConvertToRelativePath(a, tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true, CurrentDirectory: b})
		r.RelativeInsensitive = tspath.ConvertToRelativePath(a, tspath.ComparePathsOptions{UseCaseSensitiveFileNames: false, CurrentDirectory: b})
		r.ToPathSensitive = string(tspath.ToPath(a, b, true))
		r.ToPathInsensitive = string(tspath.ToPath(a, b, false))
		r.ChangeExtensionJs = tspath.ChangeExtension(a, ".js")
		r.IsDts = tspath.FileExtensionIs(a, tspath.ExtensionDts)
		r.IsJson = tspath.FileExtensionIs(a, tspath.ExtensionJson)
		r.IsTsBuildInfo = tspath.FileExtensionIs(a, tspath.ExtensionTsBuildInfo)
		r.CompareSensitive = tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true}.GetComparer()(a, b)
		r.CompareInsensitive = tspath.ComparePathsOptions{UseCaseSensitiveFileNames: false}.GetComparer()(a, b)
		r.RemoveTrailing = tspath.RemoveTrailingDirectorySeparator(a)
		r.EnsureTrailing = tspath.EnsureTrailingDirectorySeparator(a)
	})
	return r
}

func walk(fs vfs.FS, dir string, out *[]string, depth int) {
	if depth > 12 {
		return
	}
	e := fs.GetAccessibleEntries(dir)
	for _, f := range e.Files {
		_, link := e.Symlinks[f]
		*out = append(*out, fmt.Sprintf("F %s/%s link=%v real=%s", strings.TrimSuffix(dir, "/"), f, link, fs.Realpath(strings.TrimSuffix(dir, "/")+"/"+f)))
	}
	for _, d := range e.Directories {
		_, link := e.Symlinks[d]
		p := strings.TrimSuffix(dir, "/") + "/" + d
		*out = append(*out, fmt.Sprintf("D %s link=%v real=%s", p, link, fs.Realpath(p)))
		walk(fs, p, out, depth+1)
	}
}

func runMatch(v matchVector) (r matchResult) {
	r.Name = v.Name
	r.Panic = guard(func() {
		m := map[string]any{}
		for _, f := range v.Files {
			m[f] = ""
		}
		for link, target := range v.Symlinks {
			m[link] = vfstest.Symlink(target)
		}
		fs := vfstest.FromMap(m, v.Ucsfn)
		r.FileNames, r.Read = getFileNamesFromConfigSpecs(v.FileSpec, v.Includes, v.Excludes, v.BasePath, v.AllowJs, v.Json, fs)
		root := "/"
		for f := range m {
			if !strings.HasPrefix(f, "/") {
				root = f[:tspath.GetRootLength(f)]
			}
			break
		}
		walk(fs, root, &r.Entries, 0)
	})
	if r.Read == nil {
		r.Read = []string{}
	}
	if r.FileNames == nil {
		r.FileNames = []string{}
	}
	if r.Entries == nil {
		r.Entries = []string{}
	}
	return r
}

func main() {
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var in vectors
	if err := json.Unmarshal(data, &in); err != nil {
		panic(err)
	}
	var out results
	for _, v := range in.Paths {
		out.Paths = append(out.Paths, runPath(v))
	}
	for _, v := range in.Match {
		out.Match = append(out.Match, runMatch(v))
	}
	b, err := json.Marshal(out)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Args[2], b, 0o644); err != nil {
		panic(err)
	}
	fmt.Fprintln(os.Stderr, "paths:", len(out.Paths), "match:", len(out.Match))
}
