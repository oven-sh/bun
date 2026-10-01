# Assembles cmd/roots/main.go from line ranges of the reference, with the named textual edits only.
# usage: gen.py <tail.go.txt> <out main.go>
import re, sys
REF = "/workspace/ref/typescript-go/internal/"
def lines(path, a, b):
    with open(REF + path, encoding="utf8") as f:
        ls = f.read().split("\n")
    return "\n".join(ls[a-1:b])
def sub(text, pairs):
    for a, b in pairs:
        if a not in text:
            raise SystemExit("edit does not apply: " + repr(a))
        text = text.replace(a, b)
    return text
out = []
def emit(title, text):
    out.append("// ---- " + title + " ----\n" + text + "\n")

out.append('''// Ground truth for roots and other files: line ranges of the reference harness around the real tsoptions, parser and vfstest packages.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing/fstest"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/parser"
	"github.com/microsoft/typescript-go/internal/scanner"
	"github.com/microsoft/typescript-go/internal/tsoptions"
	"github.com/microsoft/typescript-go/internal/tsoptions/tsoptionstest"
	"github.com/microsoft/typescript-go/internal/tspath"
	"github.com/microsoft/typescript-go/internal/vfs/iovfs"
	"github.com/microsoft/typescript-go/internal/vfs/vfstest"
)

// Stand-in for *testing.T: Fatalf and Skipf stop the instance with a recorded reason.
type T struct{}
type fatalStop struct{ msg string }
type skipStop struct{ msg string }

func (t *T) Fatalf(format string, args ...any) { panic(fatalStop{fmt.Sprintf(format, args...)}) }
func (t *T) Fatal(args ...any)                 { panic(fatalStop{fmt.Sprint(args...)}) }
func (t *T) Skipf(format string, args ...any)  { panic(skipStop{fmt.Sprintf(format, args...)}) }
func (t *T) Helper()                           {}

var readFS = iovfs.From(os.DirFS("/"), true)
var testsLibDir string
''')

emit("testrunner/test_case_parser.go:18-299 (edit: harnessutil. prefix removed)",
     sub(lines("testrunner/test_case_parser.go", 18, 299), [("harnessutil.GetConfigNameFromFileName", "GetConfigNameFromFileName")]))
emit("testrunner/compiler_runner.go:27-34 (verbatim)", lines("testrunner/compiler_runner.go", 27, 34))
emit("testrunner/compiler_runner.go:86-135 (verbatim)", lines("testrunner/compiler_runner.go", 86, 135))
emit("testrunner/compiler_runner.go:161-188 (verbatim)", lines("testrunner/compiler_runner.go", 161, 188))
emit("testrunner/compiler_runner.go:226-244 (edit: T, harnessutil. prefix removed, osvfs.FS() is readFS)",
     sub(lines("testrunner/compiler_runner.go", 226, 244), [
         ("*testing.T", "*T"), ("[]*harnessutil.NamedTestConfiguration", "[]*NamedTestConfiguration"),
         ("harnessutil.GetFileBasedTestConfigurations", "GetFileBasedTestConfigurations"), ("osvfs.FS().ReadFile(filename)", "readFS.ReadFile(filename)")]))
emit("testrunner/compiler_runner.go:261-264 (edit: harnessutil. prefix removed)",
     sub(lines("testrunner/compiler_runner.go", 261, 264), [("harnessutil.TestConfiguration", "TestConfiguration")]))
nct = lines("testrunner/compiler_runner.go", 266, 338)
nct = sub(nct, [("*testing.T", "*T"), (") *compilerTest {", ") *dump {")])
nct = nct.replace("harnessutil.", "")
nct += '''
	d := CompileFiles(
		t,
		toBeCompiled,
		otherFiles,
		harnessConfig,
		tsConfig,
		currentDirectory,
		testCaseContentWithConfig.symlinks,
	)
	d.ConfiguredName = configuredName
	d.CurrentDirectory = currentDirectory
	d.HasNonDtsFiles = hasNonDtsFiles
	d.Roots = names(toBeCompiled)
	d.OtherFiles = names(otherFiles)
	d.ConfigFiles = names(tsConfigFiles)
	if tsConfig != nil {
		d.HasConfig = true
		d.ConfigFileNames = append([]string{}, tsConfig.ParsedConfig.FileNames...)
		if tsConfig.ConfigFile != nil {
			d.ExtendedSourceFiles = append([]string{}, tsConfig.ConfigFile.ExtendedSourceFiles...)
		}
		if o := tsConfig.ParsedConfig.CompilerOptions; o != nil {
			d.ConfigOptions = map[string]any{
				"outDir": o.OutDir, "declarationDir": o.DeclarationDir, "allowJs": int(o.AllowJs), "checkJs": int(o.CheckJs),
				"resolveJsonModule": int(o.ResolveJsonModule), "module": int(o.Module), "moduleResolution": int(o.ModuleResolution), "target": int(o.Target),
			}
		}
		d.ConfigErrors = len(tsConfig.Errors)
		for _, e := range tsConfig.Errors {
			d.ConfigErrorCodes = append(d.ConfigErrorCodes, int(e.Code()))
		}
	}
	return d
}'''
emit("testrunner/compiler_runner.go:266-338 (edit: T, harnessutil. prefix removed, returns the dump in place of the compilation)", nct)
emit("testrunner/compiler_runner.go:569-574 (edit: harnessutil. prefix removed)",
     lines("testrunner/compiler_runner.go", 569, 574).replace("harnessutil.", ""))

emit("harnessutil/harnessutil.go:40-79 (verbatim)", lines("testutil/harnessutil/harnessutil.go", 40, 79))
cf = lines("testutil/harnessutil/harnessutil.go", 81, 113)
cf = sub(cf, [("*testing.T", "*T"), (") *CompilationResult {", ") *dump {")])
emit("harnessutil/harnessutil.go:81-113 (edit: T, result type)", cf)
cfx_a = lines("testutil/harnessutil/harnessutil.go", 115, 156)
cfx_a = sub(cfx_a, [("*testing.T", "*T"), (") *CompilationResult {", ") *dump {")])
cfx_b = lines("testutil/harnessutil/harnessutil.go", 194, 218)
cfx_b = sub(cfx_b, [("fs := vfstest.FromMap(testfs, harnessOptions.UseCaseSensitiveFileNames)", "return finish(testfs, programFileNames, includeLibDir, harnessOptions, compilerOptions, symlinks, currentDirectory)\n}")])
emit("harnessutil/harnessutil.go:115-156 and 194-218 (edit: T, result type, stops at the creation of the file system)", cfx_a + "\n\n" + cfx_b)
tl = lines("testutil/harnessutil/harnessutil.go", 267, 290)
tl = sub(tl, [('libfs := os.DirFS(filepath.Join(repo.TypeScriptSubmodulePath(), "tests", "lib"))', "libfs := os.DirFS(testsLibDir)"), ("var testLibFolderMap = sync.OnceValue(func() map[string]any {", "var testLibFolderMapOnce map[string]any\n\nfunc testLibFolderMap() map[string]any {\n\tif testLibFolderMapOnce != nil {\n\t\treturn testLibFolderMapOnce\n\t}"), ("\treturn testfs\n})", "\ttestLibFolderMapOnce = testfs\n\treturn testfs\n}")])
tl = tl.replace("fs.WalkDir", "iofs.WalkDir").replace("fs.DirEntry", "iofs.DirEntry").replace("fs.ReadFile", "iofs.ReadFile")
emit("harnessutil/harnessutil.go:267-290 (edit: directory given by a variable, no sync.OnceValue, io/fs imported as iofs)", tl)
emit("harnessutil/harnessutil.go:292-486 (edit: T)", lines("testutil/harnessutil/harnessutil.go", 292, 486).replace("*testing.T", "*T"))
emit("harnessutil/harnessutil.go:1026-1265 (edit: T)", lines("testutil/harnessutil/harnessutil.go", 1026, 1265).replace("*testing.T", "*T"))
out.append(open(sys.argv[1]).read())
src = "\n".join(out)
src = src.replace('\t"maps"\n', '\t"maps"\n\tiofs "io/fs"\n', 1)
open(sys.argv[2], "w").write(src)
print("written", len(src))
