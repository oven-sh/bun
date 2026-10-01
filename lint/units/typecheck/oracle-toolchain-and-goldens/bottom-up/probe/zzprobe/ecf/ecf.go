// Research probe: runs typescript-go's own checker on parsed and bound files and prints the diagnostics and the state counters.
// usage: Run([-strict|-nostrict] [-unreachable-error] [-suggestions] [-maxstack N] <virtual-name>=<path>...)   names that start with lib. are library files
package ecf

import (
	"context"
	"fmt"
	"os"
	"runtime/debug"
	"strconv"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/binder"
	"github.com/microsoft/typescript-go/internal/checker"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/module"
	"github.com/microsoft/typescript-go/internal/packagejson"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/scanner"
	"github.com/microsoft/typescript-go/internal/symlinks"
	"github.com/microsoft/typescript-go/internal/tsoptions"
	"github.com/microsoft/typescript-go/internal/tspath"
)

type fakeProgram struct {
	options *core.CompilerOptions
	files   []*ast.SourceFile
}

func (p *fakeProgram) Options() *core.CompilerOptions { return p.options }
func (p *fakeProgram) SourceFiles() []*ast.SourceFile { return p.files }
func (p *fakeProgram) BindSourceFiles() {
	for _, f := range p.files {
		if !f.IsBound() {
			binder.BindSourceFile(f)
		}
	}
}
func (p *fakeProgram) FileExists(fileName string) bool { return false }
func (p *fakeProgram) GetSourceFile(fileName string) *ast.SourceFile {
	for _, f := range p.files {
		if f.FileName() == fileName {
			return f
		}
	}
	return nil
}
func (p *fakeProgram) GetSourceFileForResolvedModule(fileName string) *ast.SourceFile {
	return p.GetSourceFile(fileName)
}
func (p *fakeProgram) GetEmitModuleFormatOfFile(sourceFile ast.HasFileName) core.ModuleKind {
	return ast.GetEmitModuleFormatOfFileWorker(sourceFile.FileName(), p.options, ast.SourceFileMetaData{})
}
func (p *fakeProgram) GetEmitSyntaxForUsageLocation(sourceFile ast.HasFileName, usageLocation *ast.StringLiteralLike) core.ResolutionMode {
	return core.ModuleKindNone
}
func (p *fakeProgram) GetImpliedNodeFormatForEmit(sourceFile ast.HasFileName) core.ModuleKind {
	return ast.GetImpliedNodeFormatForEmitWorker(sourceFile.FileName(), p.options.GetEmitModuleKind(), ast.SourceFileMetaData{})
}
func (p *fakeProgram) GetResolvedModule(currentSourceFile ast.HasFileName, moduleReference string, mode core.ResolutionMode) *module.ResolvedModule {
	return nil
}
func (p *fakeProgram) GetResolvedModules() map[tspath.Path]module.ModeAwareCache[*module.ResolvedModule] {
	return nil
}
func (p *fakeProgram) GetPackagesMap() map[string]bool { return nil }
func (p *fakeProgram) GetSourceFileMetaData(path tspath.Path) ast.SourceFileMetaData {
	return ast.SourceFileMetaData{}
}
func (p *fakeProgram) GetJSXRuntimeImportSpecifier(path tspath.Path) (string, *ast.Node) {
	return "", nil
}
func (p *fakeProgram) GetImportHelpersImportSpecifier(path tspath.Path) *ast.Node { return nil }
func (p *fakeProgram) SourceFileMayBeEmitted(sourceFile *ast.SourceFile, forceDtsEmit bool) bool {
	return !sourceFile.IsDeclarationFile
}
func (p *fakeProgram) IsSourceFileDefaultLibrary(path tspath.Path) bool {
	return strings.HasPrefix(string(path), "/lib.")
}
func (p *fakeProgram) GetProjectReferenceFromOutputDts(path tspath.Path) *tsoptions.SourceOutputAndProjectReference {
	return nil
}
func (p *fakeProgram) GetRedirectForResolution(file ast.HasFileName) *tsoptions.ParsedCommandLine {
	return nil
}
func (p *fakeProgram) CommonSourceDirectory() string { return "/" }

func (p *fakeProgram) GetSymlinkCache() *symlinks.KnownSymlinks { return nil }
func (p *fakeProgram) ContentMapperExtensions() []string        { return nil }
func (p *fakeProgram) GetGlobalTypingsCacheLocation() string    { return "" }
func (p *fakeProgram) UseCaseSensitiveFileNames() bool          { return true }
func (p *fakeProgram) GetCurrentDirectory() string              { return "/" }
func (p *fakeProgram) GetProjectReferenceFromSource(path tspath.Path) *tsoptions.SourceOutputAndProjectReference {
	return nil
}
func (p *fakeProgram) GetRedirectTargets(path tspath.Path) []string { return nil }
func (p *fakeProgram) GetSourceOfProjectReferenceIfOutputIncluded(file ast.HasFileName) string {
	return file.FileName()
}
func (p *fakeProgram) GetNearestAncestorDirectoryWithPackageJson(dirname string) string { return "" }
func (p *fakeProgram) GetPackageJsonInfo(pkgJsonPath string) *packagejson.InfoCacheEntry {
	return nil
}
func (p *fakeProgram) GetDefaultResolutionModeForFile(file ast.HasFileName) core.ResolutionMode {
	return core.ResolutionModeNone
}
func (p *fakeProgram) GetResolvedModuleFromModuleSpecifier(file ast.HasFileName, moduleSpecifier *ast.StringLiteralLike) *module.ResolvedModule {
	return nil
}
func (p *fakeProgram) GetModeForUsageLocation(file ast.HasFileName, moduleSpecifier *ast.StringLiteralLike) core.ResolutionMode {
	return core.ResolutionModeNone
}

func category(d *ast.Diagnostic) string {
	s := strings.ToLower(d.Category().Name())
	return s
}

func printDiagnostic(d *ast.Diagnostic, indent string, kind string) {
	where := ""
	if f := d.File(); f != nil {
		line, col := scanner.GetECMALineAndUTF16CharacterOfPosition(f, d.Pos())
		where = fmt.Sprintf("%s(%d,%d)", strings.TrimPrefix(f.FileName(), "/"), line+1, int(col)+1)
	}
	fmt.Printf("%s%s%s: %s TS%d: %s [len=%d]\n", indent, kind, where, category(d), d.Code(), d.String(), d.Len())
	for _, c := range d.MessageChain() {
		printChain(c, indent+"  ")
	}
	for _, r := range d.RelatedInformation() {
		printDiagnostic(r, indent+"  ", "RELATED ")
	}
}

func printChain(d *ast.Diagnostic, indent string) {
	fmt.Printf("%sCHAIN TS%d: %s\n", indent, d.Code(), d.String())
	for _, c := range d.MessageChain() {
		printChain(c, indent+"  ")
	}
}

func Run(args []string) {
	options := &core.CompilerOptions{}
	suggestions := false
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-strict":
			options.Strict = core.TSTrue
		case "-nostrict":
			options.Strict = core.TSFalse
		case "-unreachable-error":
			options.AllowUnreachableCode = core.TSFalse
		case "-suggestions":
			suggestions = true
		case "-maxstack":
			n, _ := strconv.Atoi(args[1])
			debug.SetMaxStack(n)
			args = args[1:]
		}
		args = args[1:]
	}
	p := &fakeProgram{options: options}
	var user []*ast.SourceFile
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
		if !strings.HasPrefix(fields[0], "lib.") {
			user = append(user, sf)
		}
	}
	c, _ := checker.NewChecker(p, nil)
	fmt.Print("AFTER NewChecker\n" + checker.ProbeState(c))
	ctx := context.Background()
	for _, f := range user {
		for _, d := range f.Diagnostics() {
			printDiagnostic(d, "", "PARSE ")
		}
		for _, d := range f.BindDiagnostics() {
			printDiagnostic(d, "", "BIND ")
		}
		for _, d := range c.GetDiagnostics(ctx, f) {
			printDiagnostic(d, "", "")
		}
		if suggestions {
			for _, d := range c.GetSuggestionDiagnostics(ctx, f) {
				printDiagnostic(d, "", "SUGGESTION ")
			}
		}
	}
	for _, d := range c.GetGlobalDiagnostics() {
		printDiagnostic(d, "", "GLOBAL ")
	}
	fmt.Print("AFTER check\n" + checker.ProbeState(c))
}

// Main runs the probe with the arguments of the process.
func Main() { Run(os.Args[1:]) }
