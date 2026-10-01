// Research probe: the program of this package for the other sub-commands (same construction as Main).
package decl

import (
	"fmt"
	"os"
	"strings"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/tspath"
)

// SetOption sets one compiler option from key=value (true, false, #<number> for enums, else a string).
func SetOption(options *core.CompilerOptions, kv string) { setOption(options, kv) }

// Files returns the parsed files in argument order.
func (p *fakeProgram) Files() []*ast.SourceFile { return p.files }

// NewProgram parses <virtual-name>=<path> arguments and binds the files. Names that start with lib. are library files.
func NewProgram(options *core.CompilerOptions, args []string) *fakeProgram {
	p := &fakeProgram{options: options, calls: map[string]int{}}
	for _, a := range args {
		fields := strings.SplitN(a, "=", 2)
		if len(fields) != 2 {
			fmt.Fprintln(os.Stderr, "expected <virtual-name>=<path>:", a)
			os.Exit(2)
		}
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
	return p
}
