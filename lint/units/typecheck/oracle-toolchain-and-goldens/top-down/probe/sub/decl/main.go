// Imported from units/typecheck/checker-declarations-grammar-jsx/bottom-up/groundtruth/declprobe_main.go.txt by import-legacy.sh. Do not edit here.
// Research probe: runs typescript-go's checker on parsed and bound files with chosen options and prints parse counts, diagnostics and suggestions.
// usage: declprobe [-strict] [-checkjs] [-sugg] [-o key=value]... <virtual-name>=<path>...   value: true, false, #<number> for enums, else a string
package decl

import (
	"context"
	"github.com/microsoft/typescript-go/internal/scanner"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/binder"
	"github.com/microsoft/typescript-go/internal/checker"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/module"
	"github.com/microsoft/typescript-go/internal/packagejson"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/symlinks"
	"github.com/microsoft/typescript-go/internal/tsoptions"
	"github.com/microsoft/typescript-go/internal/tspath"
)

type fakeProgram struct {
	options *core.CompilerOptions
	files   []*ast.SourceFile
	calls   map[string]int
	helpers map[tspath.Path]*ast.Node
	jsxRefs map[tspath.Path]string
	jsxSpec map[tspath.Path]*ast.Node
}

func (p *fakeProgram) note(name string) { p.calls[name]++ }

func (p *fakeProgram) Options() *core.CompilerOptions { p.note("Options"); return p.options }
func (p *fakeProgram) SourceFiles() []*ast.SourceFile { p.note("SourceFiles"); return p.files }
func (p *fakeProgram) BindSourceFiles() {
	p.note("BindSourceFiles")
	for _, f := range p.files {
		if !f.IsBound() {
			binder.BindSourceFile(f)
		}
	}
}
func (p *fakeProgram) FileExists(fileName string) bool { p.note("FileExists"); return false }
func (p *fakeProgram) GetSourceFile(fileName string) *ast.SourceFile {
	p.note("GetSourceFile")
	for _, f := range p.files {
		if f.FileName() == fileName {
			return f
		}
	}
	return nil
}
func (p *fakeProgram) GetSourceFileForResolvedModule(fileName string) *ast.SourceFile {
	p.note("GetSourceFileForResolvedModule")
	return p.GetSourceFile(fileName)
}
func (p *fakeProgram) GetEmitModuleFormatOfFile(sourceFile ast.HasFileName) core.ModuleKind {
	p.note("GetEmitModuleFormatOfFile")
	return ast.GetEmitModuleFormatOfFileWorker(sourceFile.FileName(), p.options, ast.SourceFileMetaData{})
}
func (p *fakeProgram) GetEmitSyntaxForUsageLocation(sourceFile ast.HasFileName, usageLocation *ast.StringLiteralLike) core.ResolutionMode {
	p.note("GetEmitSyntaxForUsageLocation")
	return core.ModuleKindNone
}
func (p *fakeProgram) GetImpliedNodeFormatForEmit(sourceFile ast.HasFileName) core.ModuleKind {
	p.note("GetImpliedNodeFormatForEmit")
	return ast.GetImpliedNodeFormatForEmitWorker(sourceFile.FileName(), p.options.GetEmitModuleKind(), ast.SourceFileMetaData{})
}
func (p *fakeProgram) GetResolvedModule(currentSourceFile ast.HasFileName, moduleReference string, mode core.ResolutionMode) *module.ResolvedModule {
	p.note("GetResolvedModule")
	if strings.HasPrefix(moduleReference, "./") {
		dir := tspath.GetDirectoryPath(currentSourceFile.FileName())
		for _, ext := range []string{".ts", ".d.ts"} {
			name := tspath.CombinePaths(dir, moduleReference[2:]+ext)
			for _, f := range p.files {
				if f.FileName() == name {
					return &module.ResolvedModule{ResolvedFileName: name, Extension: ext}
				}
			}
		}
	}
	for _, f := range p.files {
		if f.FileName() == "/"+moduleReference+".d.ts" {
			return &module.ResolvedModule{ResolvedFileName: f.FileName(), Extension: ".d.ts"}
		}
	}
	return nil
}
func (p *fakeProgram) GetResolvedModules() map[tspath.Path]module.ModeAwareCache[*module.ResolvedModule] {
	p.note("GetResolvedModules")
	return nil
}
func (p *fakeProgram) GetPackagesMap() map[string]bool { p.note("GetPackagesMap"); return nil }
func (p *fakeProgram) GetSourceFileMetaData(path tspath.Path) ast.SourceFileMetaData {
	p.note("GetSourceFileMetaData")
	return ast.SourceFileMetaData{}
}
func (p *fakeProgram) GetJSXRuntimeImportSpecifier(path tspath.Path) (string, *ast.Node) {
	p.note("GetJSXRuntimeImportSpecifier")
	return p.jsxRefs[path], p.jsxSpec[path]
}
func (p *fakeProgram) GetImportHelpersImportSpecifier(path tspath.Path) *ast.Node {
	p.note("GetImportHelpersImportSpecifier")
	return p.helpers[path]
}
func (p *fakeProgram) SourceFileMayBeEmitted(sourceFile *ast.SourceFile, forceDtsEmit bool) bool {
	p.note("SourceFileMayBeEmitted")
	return !sourceFile.IsDeclarationFile
}
func (p *fakeProgram) IsSourceFileDefaultLibrary(path tspath.Path) bool {
	p.note("IsSourceFileDefaultLibrary")
	return strings.HasPrefix(string(path), "/lib.")
}
func (p *fakeProgram) GetProjectReferenceFromOutputDts(path tspath.Path) *tsoptions.SourceOutputAndProjectReference {
	p.note("GetProjectReferenceFromOutputDts")
	return nil
}
func (p *fakeProgram) GetRedirectForResolution(file ast.HasFileName) *tsoptions.ParsedCommandLine {
	p.note("GetRedirectForResolution")
	return nil
}
func (p *fakeProgram) CommonSourceDirectory() string { p.note("CommonSourceDirectory"); return "/" }

func (p *fakeProgram) GetSymlinkCache() *symlinks.KnownSymlinks { p.note("GetSymlinkCache"); return nil }
func (p *fakeProgram) ContentMapperExtensions() []string        { p.note("ContentMapperExtensions"); return nil }
func (p *fakeProgram) GetGlobalTypingsCacheLocation() string    { p.note("GetGlobalTypingsCacheLocation"); return "" }
func (p *fakeProgram) UseCaseSensitiveFileNames() bool          { p.note("UseCaseSensitiveFileNames"); return true }
func (p *fakeProgram) GetCurrentDirectory() string              { p.note("GetCurrentDirectory"); return "/" }
func (p *fakeProgram) GetProjectReferenceFromSource(path tspath.Path) *tsoptions.SourceOutputAndProjectReference {
	p.note("GetProjectReferenceFromSource")
	return nil
}
func (p *fakeProgram) GetRedirectTargets(path tspath.Path) []string { p.note("GetRedirectTargets"); return nil }
func (p *fakeProgram) GetSourceOfProjectReferenceIfOutputIncluded(file ast.HasFileName) string {
	p.note("GetSourceOfProjectReferenceIfOutputIncluded")
	return file.FileName()
}
func (p *fakeProgram) GetNearestAncestorDirectoryWithPackageJson(dirname string) string {
	p.note("GetNearestAncestorDirectoryWithPackageJson")
	return ""
}
func (p *fakeProgram) GetPackageJsonInfo(pkgJsonPath string) *packagejson.InfoCacheEntry {
	p.note("GetPackageJsonInfo")
	return nil
}
func (p *fakeProgram) GetDefaultResolutionModeForFile(file ast.HasFileName) core.ResolutionMode {
	p.note("GetDefaultResolutionModeForFile")
	return core.ResolutionModeNone
}
func (p *fakeProgram) GetResolvedModuleFromModuleSpecifier(file ast.HasFileName, moduleSpecifier *ast.StringLiteralLike) *module.ResolvedModule {
	p.note("GetResolvedModuleFromModuleSpecifier")
	return p.GetResolvedModule(file, moduleSpecifier.Text(), core.ResolutionModeNone)
}
func (p *fakeProgram) GetModeForUsageLocation(file ast.HasFileName, moduleSpecifier *ast.StringLiteralLike) core.ResolutionMode {
	p.note("GetModeForUsageLocation")
	return core.ResolutionModeNone
}

func setOption(options *core.CompilerOptions, kv string) {
	fields := strings.SplitN(kv, "=", 2)
	if len(fields) != 2 {
		fmt.Fprintln(os.Stderr, "bad option", kv)
		os.Exit(1)
	}
	var value any = fields[1]
	switch {
	case fields[1] == "true":
		value = true
	case fields[1] == "false":
		value = false
	case strings.HasPrefix(fields[1], "#"):
		n, err := strconv.Atoi(fields[1][1:])
		if err != nil {
			fmt.Fprintln(os.Stderr, "bad number", kv)
			os.Exit(1)
		}
		value = float64(n)
	}
	tsoptions.ParseCompilerOptions(fields[0], value, options)
}

func printDiag(f *ast.SourceFile, d *ast.Diagnostic, indent string, label string) {
	where := "<no file>"
	if df := d.File(); df != nil {
		line, ch := scanner.GetECMALineAndUTF16CharacterOfPosition(df, d.Pos())
		where = fmt.Sprintf("%s(%d,%d)+%d", strings.TrimPrefix(df.FileName(), "/"), line+1, int(ch)+1, d.Len())
	}
	extra := ""
	if d.SkippedOnNoEmit() {
		extra += " [skippedOnNoEmit]"
	}
	if d.ReportsUnnecessary() {
		extra += " [unnecessary]"
	}
	if d.ReportsDeprecated() {
		extra += " [deprecated]"
	}
	fmt.Printf("%s%s%s: %s TS%d: %s%s\n", indent, label, where, d.Category().Name(), d.Code(), d.String(), extra)
	for _, m := range d.MessageChain() {
		printChain(m, indent+"  ")
	}
	for _, r := range d.RelatedInformation() {
		printDiag(f, r, indent+"  ", "related ")
	}
}

func printChain(d *ast.Diagnostic, indent string) {
	fmt.Printf("%schain TS%d: %s\n", indent, d.Code(), d.String())
	for _, m := range d.MessageChain() {
		printChain(m, indent+"  ")
	}
}

func Main() {
	args := os.Args[1:]
	options := &core.CompilerOptions{}
	sugg := false
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-strict":
			options.Strict = core.TSTrue
		case "-nostrict":
			options.Strict = core.TSFalse
		case "-checkjs":
			options.AllowJs = core.TSTrue
			options.CheckJs = core.TSTrue
		case "-sugg":
			sugg = true
		case "-o":
			setOption(options, args[1])
			args = args[1:]
		}
		args = args[1:]
	}
	p := &fakeProgram{options: options, calls: map[string]int{}}
	for _, a := range args {
		fields := strings.SplitN(a, "=", 2)
		b, err := os.ReadFile(fields[1])
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		text := strings.TrimPrefix(string(b), "\ufeff")
		fileName := tspath.NormalizePath("/" + fields[0])
		sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName: fileName,
			Path:     tspath.Path(fileName),
		}, text, core.EnsureScriptKindFromFileName(fileName))
		p.files = append(p.files, sf)
	}
	// Same rule as compiler/fileloader.go resolveImportsAndModuleAugmentations: synthetic imports for tslib and the JSX runtime.
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	synth := func(text string, file *ast.SourceFile) *ast.Node {
		lit := factory.NewStringLiteral(text, ast.TokenFlagsNone)
		imp := factory.NewImportDeclaration(nil, nil, lit, nil)
		lit.Parent = imp
		imp.Parent = file.AsNode()
		return lit
	}
	p.helpers = map[tspath.Path]*ast.Node{}
	p.jsxRefs = map[tspath.Path]string{}
	p.jsxSpec = map[tspath.Path]*ast.Node{}
	for _, f := range p.files {
		isJS := ast.IsSourceFileJS(f)
		if isJS || (!f.IsDeclarationFile && (options.GetIsolatedModules() || ast.IsExternalModule(f))) {
			if options.ImportHelpers.IsTrue() {
				p.helpers[f.Path()] = synth("tslib", f)
			}
		}
		if isJS || f.ScriptKind == core.ScriptKindTSX {
			if jsxImport := ast.GetJSXRuntimeImport(ast.GetJSXImplicitImportBase(options, f), options); jsxImport != "" {
				p.jsxRefs[f.Path()] = jsxImport
				p.jsxSpec[f.Path()] = synth(jsxImport, f)
			}
		}
	}
	p.BindSourceFiles()
	c, _ := checker.NewChecker(p, nil)
	for _, f := range p.files {
		if strings.HasPrefix(f.FileName(), "/lib.") {
			continue
		}
		var pc []string
		for _, d := range f.Diagnostics() {
			pc = append(pc, "TS"+strconv.Itoa(int(d.Code())))
		}
		var jc []string
		for _, d := range f.JSDiagnostics() {
			jc = append(jc, "TS"+strconv.Itoa(int(d.Code())))
		}
		var bc []string
		for _, d := range f.BindDiagnostics() {
			bc = append(bc, "TS"+strconv.Itoa(int(d.Code())))
		}
		fmt.Printf("PARSE %s parse=%v js=%v bind=%v\n", strings.TrimPrefix(f.FileName(), "/"), pc, jc, bc)
		for _, d := range c.GetDiagnostics(context.Background(), f) {
			printDiag(f, d, "", "")
		}
		if sugg {
			for _, d := range c.GetSuggestionDiagnostics(context.Background(), f) {
				printDiag(f, d, "", "SUGGEST ")
			}
		}
	}
	fmt.Printf("RESOLUTIONDEPTH %d %v\n", c.ProbeResolutionDepth(), c.ProbeResolutionStack())
	for _, d := range c.GetGlobalDiagnostics() {
		fmt.Printf("global: error TS%d: %s\n", d.Code(), d.String())
	}
	var names []string
	for k, v := range p.calls {
		names = append(names, fmt.Sprintf("%s=%d", k, v))
	}
	sort.Strings(names)
	fmt.Printf("PROGRAM %s\n", strings.Join(names, " "))
	fmt.Printf("COUNTS TypeCount=%d SymbolCount=%d SignatureCount=%d TotalInstantiationCount=%d\n", c.TypeCount, c.SymbolCount, c.SignatureCount, c.TotalInstantiationCount)
}
