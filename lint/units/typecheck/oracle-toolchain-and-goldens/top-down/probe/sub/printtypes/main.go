// Imported from units/typecheck/checker-type-printer/bottom-up/groundtruth/ctpprobe2_main.go.txt by import-legacy.sh. Do not edit here.
// Research probe: the reference's type printer on the types of variable annotations (an annotation gives a type
// without an alias symbol, so the structure is printed). Every top-level `declare const x: <type>` of the last file
// gives one line:
//   <variable name> <tab> TypeToString <tab> typeToStringEx with UseFullyQualifiedType <tab> typeToString with the variable declaration as enclosing declaration
// usage: ctpprobe2 [-strict|-nostrict] [-notrunc] <virtual-name>=<path>...      (lib files first, names starting with lib.)
// -notrunc sets noErrorTruncation, which the reference's test harness sets for every case by default.
package printtypes

import (
	"fmt"
	"os"
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
	return "", nil
}
func (p *fakeProgram) GetImportHelpersImportSpecifier(path tspath.Path) *ast.Node {
	p.note("GetImportHelpersImportSpecifier")
	return nil
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

func Main() {
	args := os.Args[1:]
	options := &core.CompilerOptions{}
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-strict":
			options.Strict = core.TSTrue
		case "-nostrict":
			options.Strict = core.TSFalse
		case "-notrunc":
			options.NoErrorTruncation = core.TSTrue
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
	p.BindSourceFiles()
	c, _ := checker.NewChecker(p, nil)
	f := p.files[len(p.files)-1]
	for _, s := range f.Statements.Nodes {
		if s.Kind != ast.KindVariableStatement {
			continue
		}
		for _, d := range s.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			if d.Type() == nil {
				continue
			}
			a, b, e := c.ProbeTypeNodeToStrings(d.Type())
			fmt.Printf("%s\t%s\t%s\t%s\n", d.Name().Text(), a, b, e)
		}
	}
}
