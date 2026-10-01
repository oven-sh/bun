// Research probe: the structural oracle of the checker state ("checker-state v1", see FORMATS.txt next to bootstrap.sh).
// Parses and binds the files, runs typescript-go's NewChecker, runs the drive steps in the order given, and prints
// every type, signature, transient symbol and symbol link record that exists then, in creation order.
// usage: state [-strict|-nostrict] [-checkjs] [-o key=value]... [-drive step[,step...]]... [-all] [-marks] [-fields]
//              [-globals] [-nolinks] [-diagtext] [-dumpeach] <virtual-name>=<path>...
// A file whose virtual name starts with lib. is a library file: it is loaded but not driven.
// Without -all the dump starts after the types and signatures that NewChecker made.
package state

import (
	"fmt"
	"os"
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

func Main() {
	args := os.Args[1:]
	options := &core.CompilerOptions{}
	var steps []string
	var shown []string
	all, marks, fields, globals, links, diagText, each := false, false, false, false, true, false, false
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-strict":
			options.Strict = core.TSTrue
			shown = append(shown, "strict=true")
		case "-nostrict":
			options.Strict = core.TSFalse
			shown = append(shown, "strict=false")
		case "-checkjs":
			options.AllowJs = core.TSTrue
			options.CheckJs = core.TSTrue
			shown = append(shown, "allowJs=true", "checkJs=true")
		case "-o":
			setOption(options, args[1])
			shown = append(shown, args[1])
			args = args[1:]
		case "-drive":
			steps = append(steps, strings.Split(args[1], ",")...)
			args = args[1:]
		case "-all":
			all = true
		case "-marks":
			marks = true
		case "-fields":
			fields = true
		case "-globals":
			globals = true
		case "-nolinks":
			links = false
		case "-diagtext":
			diagText = true
		case "-dumpeach":
			each = true
		default:
			fmt.Fprintln(os.Stderr, "unknown flag", args[0])
			os.Exit(2)
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
	checker.ProbeRecordOn = true
	p.BindSourceFiles()
	c, _ := checker.NewChecker(p, nil)
	var user []*ast.SourceFile
	for _, f := range p.files {
		if !strings.HasPrefix(f.FileName(), "/lib.") {
			user = append(user, f)
		}
	}
	o := checker.ProbeStateOptions{Marks: marks, Fields: fields, Globals: globals, Links: links, DiagText: diagText, Files: p.files}
	if !all {
		o.SinceType, o.SinceSignature = checker.ProbeCounts(c)
	}
	fmt.Print("checker-state v1\n")
	fmt.Printf("OPTIONS [%s]\n", strings.Join(shown, " "))
	for _, f := range p.files {
		fmt.Printf("FILE %s\n", f.FileName())
	}
	fmt.Printf("SINCE type=%d signature=%d\n", o.SinceType, o.SinceSignature)
	for _, step := range steps {
		fmt.Printf("DRIVE %s\n", step)
		for _, l := range checker.ProbeDrive(c, user, step, o.SinceType) {
			fmt.Println(l)
		}
		if each {
			fmt.Printf("STATE after %s\n", step)
			fmt.Print(checker.ProbeStateDump(c, o))
		}
	}
	if !each || len(steps) == 0 {
		fmt.Print("STATE\n")
		fmt.Print(checker.ProbeStateDump(c, o))
	}
	_ = strconv.Itoa
}
