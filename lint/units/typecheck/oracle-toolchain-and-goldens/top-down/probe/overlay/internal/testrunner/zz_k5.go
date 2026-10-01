// Imported from units/typecheck/drivers-k4-k5/top-down/groundtruth/zz_k5.with-opts.go.txt by import-legacy.sh. Do not edit here.
package testrunner

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/microsoft/typescript-go/internal/ast"
	tsjson "github.com/microsoft/typescript-go/internal/json"
	"github.com/microsoft/typescript-go/internal/module"
)

var k5Mu sync.Mutex

type k5File struct {
	N       string  `json:"n"`
	SK      int     `json:"sk"`
	Dts     bool    `json:"dts,omitempty"`
	Fmt     int     `json:"fmt"`
	PJT     string  `json:"pjt,omitempty"`
	PJD     string  `json:"pjd,omitempty"`
	EMI     bool    `json:"emi,omitempty"`
	CJS     bool    `json:"cjs,omitempty"`
	Ext     bool    `json:"ext,omitempty"`
	Jsx     string  `json:"jsx,omitempty"`
	Helpers bool    `json:"helpers,omitempty"`
	Imports int     `json:"imports,omitempty"`
	Refs    int     `json:"refs,omitempty"`
	TypeRef int     `json:"typerefs,omitempty"`
	LibRefs int     `json:"librefs,omitempty"`
	Res     [][]any `json:"res,omitempty"`
	// The inputs of the load order, in source order.
	RefList  [][]any `json:"reflist,omitempty"`
	TypeList [][]any `json:"typelist,omitempty"`
	LibList  []string `json:"liblist,omitempty"`
	ImpList  [][]any `json:"implist,omitempty"`
	AugList  []string `json:"auglist,omitempty"`
	NoDefaultLib bool `json:"nodefaultlib,omitempty"`
}

type k5Row struct {
	Suite   string           `json:"suite"`
	Name    string           `json:"name"`
	Cwd     string           `json:"cwd"`
	Roots   []string         `json:"roots"`
	Libs    string           `json:"libs"`
	Files   []k5File         `json:"files"`
	AutoTypes [][]any        `json:"autotypes,omitempty"`
	LibFiles []k5File        `json:"libfiles,omitempty"`
	Options map[string]any   `json:"options"`
	Opts    json.RawMessage  `json:"opts"`
	Diag    map[string][]int `json:"diag"`
	Pre     int              `json:"pre"`
	Post    int              `json:"post"`
	Used    int              `json:"used"`
	CaseSensitive bool       `json:"caseSensitive"`
	Symlinks int             `json:"symlinks,omitempty"`
	Common  string           `json:"common,omitempty"`
}

// Research probe: one line per run instance with the program that the harness built and where its diagnostics come from.
func k5Record(suite string, c *compilerTest) {
	dir := os.Getenv("K5_MANIFEST_DIR")
	if dir == "" || c.result == nil || c.result.Program == nil {
		return
	}
	p := c.result.Program.Program()
	row := k5Row{Suite: suite, Name: c.configuredName, Cwd: c.currentDirectory, Roots: p.CommandLine().FileNames()}
	var libs []string
	resolved := p.GetResolvedModules()
	for _, f := range p.SourceFiles() {
		isLib := p.IsSourceFileDefaultLibrary(f.Path())
		if isLib {
			name := f.FileName()
			name = strings.TrimPrefix(name, "bundled:///libs/")
			libs = append(libs, name)
			if strings.HasPrefix(f.FileName(), "bundled:///libs/") && len(f.ReferencedFiles) == 0 && len(f.TypeReferenceDirectives) == 0 && len(f.Imports()) == 0 {
				continue
			}
		}
		meta := p.GetSourceFileMetaData(f.Path())
		kf := k5File{
			N: f.FileName(), SK: int(f.ScriptKind), Dts: f.IsDeclarationFile, Fmt: int(meta.ImpliedNodeFormat),
			PJT: meta.PackageJsonType, PJD: meta.PackageJsonDirectory,
			EMI: f.ExternalModuleIndicator != nil, CJS: f.CommonJSModuleIndicator != nil,
			Ext: p.IsSourceFileFromExternalLibrary(f),
			Imports: len(f.Imports()), Refs: len(f.ReferencedFiles), TypeRef: len(f.TypeReferenceDirectives), LibRefs: len(f.LibReferenceDirectives),
		}
		if ref, _ := p.GetJSXRuntimeImportSpecifier(f.Path()); ref != "" {
			kf.Jsx = ref
		}
		kf.Helpers = p.GetImportHelpersImportSpecifier(f.Path()) != nil
		cache := resolved[f.Path()]
		keys := make([]module.ModeAwareCacheKey, 0, len(cache))
		for k := range cache {
			keys = append(keys, k)
		}
		slices.SortFunc(keys, func(a, b module.ModeAwareCacheKey) int {
			if r := strings.Compare(a.Name, b.Name); r != 0 {
				return r
			}
			return int(a.Mode) - int(b.Mode)
		})
		for _, k := range keys {
			r := cache[k]
			if r == nil {
				kf.Res = append(kf.Res, []any{k.Name, int(k.Mode)})
				continue
			}
			kf.Res = append(kf.Res, []any{k.Name, int(k.Mode), r.ResolvedFileName, r.Extension, r.IsExternalLibraryImport, r.PackageId.Name, r.ResolvedUsingTsExtension, r.OriginalPath, r.PackageId.SubModuleName, r.PackageId.Version, r.PackageId.PeerDependencies, r.AlternateResult, r.ResolvedUsingExtraExtensions})
		}
		for _, ref := range f.ReferencedFiles {
			target := ""
			if sf := p.GetSourceFileFromReference(f, ref); sf != nil {
				target = sf.FileName()
			}
			kf.RefList = append(kf.RefList, []any{ref.FileName, target})
		}
		for _, ref := range f.TypeReferenceDirectives {
			target := ""
			ext := false
			if r := p.GetResolvedTypeReferenceDirectiveFromTypeReferenceDirective(ref, f); r != nil && r.IsResolved() {
				target = r.ResolvedFileName
				ext = r.IsExternalLibraryImport
			}
			kf.TypeList = append(kf.TypeList, []any{ref.FileName, int(ref.ResolutionMode), target, ext})
		}
		for _, ref := range f.LibReferenceDirectives {
			kf.LibList = append(kf.LibList, ref.FileName)
		}
		for _, imp := range f.Imports() {
			mode := p.GetModeForUsageLocation(f, imp)
			target := ""
			ext := false
			if r := p.GetResolvedModule(f, imp.Text(), mode); r != nil && r.IsResolved() {
				target = r.ResolvedFileName
				ext = r.IsExternalLibraryImport
			}
			kf.ImpList = append(kf.ImpList, []any{imp.Text(), int(mode), target, ext, imp.Flags&ast.NodeFlagsJSDoc != 0, ast.IsInJSFile(imp)})
		}
		for _, aug := range f.ModuleAugmentations {
			if aug.Kind == ast.KindStringLiteral {
				kf.AugList = append(kf.AugList, aug.Text())
			}
		}
		kf.NoDefaultLib = false
		if isLib {
			row.LibFiles = append(row.LibFiles, kf)
		} else {
			row.Files = append(row.Files, kf)
		}
	}
	var autoCache module.ModeAwareCache[*module.ResolvedTypeReferenceDirective]
	for path, cache := range p.GetResolvedTypeReferenceDirectives() {
		if strings.HasSuffix(string(path), strings.ToLower(module.InferredTypesContainingFile)) || strings.HasSuffix(string(path), module.InferredTypesContainingFile) {
			autoCache = cache
		}
	}
	for _, name := range module.GetAutomaticTypeDirectiveNames(p.Options(), p.Host()) {
		target := ""
		ext := false
		if r := autoCache[module.ModeAwareCacheKey{Name: name}]; r != nil && r.IsResolved() {
			target = r.ResolvedFileName
			ext = r.IsExternalLibraryImport
		}
		row.AutoTypes = append(row.AutoTypes, []any{name, target, ext})
	}
	row.Libs = strings.Join(libs, ",")
	o := p.Options()
	row.Options = map[string]any{
		"target": int(o.GetEmitScriptTarget()), "module": int(o.GetEmitModuleKind()), "moduleResolution": int(o.GetModuleResolutionKind()),
		"moduleDetection": int(o.GetEmitModuleDetectionKind()), "jsx": int(o.Jsx), "noLib": int(o.NoLib), "lib": o.Lib,
		"skipLibCheck": int(o.SkipLibCheck), "skipDefaultLibCheck": int(o.SkipDefaultLibCheck), "noCheck": int(o.NoCheck),
		"declaration": o.GetEmitDeclarations(), "noEmit": int(o.NoEmit), "isolatedModules": o.GetIsolatedModules(),
		"checkJs": int(o.CheckJs), "allowJs": o.GetAllowJS(), "types": o.Types, "pretty": int(o.Pretty), "importHelpers": int(o.ImportHelpers),
		"noResolve": int(o.NoResolve), "incremental": int(o.Incremental), "composite": int(o.Composite),
	}
	if raw, err := tsjson.Marshal(o); err == nil {
		row.Opts = json.RawMessage(raw)
	} else {
		row.Opts = json.RawMessage(`{"error":"` + strings.ReplaceAll(err.Error(), `"`, `'`) + `"}`)
	}
	row.Diag = map[string][]int{}
	for k, ds := range c.result.K5 {
		codes := make([]int, 0, len(ds))
		for _, d := range ds {
			codes = append(codes, int(d.Code()))
		}
		row.Diag[k] = codes
	}
	row.Pre, row.Post, row.Used = c.result.K5Pre, c.result.K5Post, len(c.result.Diagnostics)
	row.CaseSensitive = p.UseCaseSensitiveFileNames()
	row.Symlinks = len(c.result.Symlinks)
	_ = context.Background
	_ = ast.KindUnknown
	b, err := json.Marshal(row)
	if err != nil {
		return
	}
	k5Mu.Lock()
	defer k5Mu.Unlock()
	f, err := os.OpenFile(filepath.Join(dir, "manifest.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.Write(append(b, '\n'))
	_ = f.Close()
}
