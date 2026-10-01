#!/usr/bin/env python3
# Patches a COPY of typescript-go (89d5d5b) so that TestSubmodule records, for each run instance, the error baseline before and after the emit.
# usage: python3 patch.py <copy of typescript-go>; then run the test binary with OE_PREPOST_DIR=<out dir>
import sys
root = sys.argv[1]
p = root + "/internal/testutil/harnessutil/harnessutil.go"
s = open(p).read()
old = "\treturn newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)\n}\n"
assert s.count(old) == 1
s = s.replace(old, "\tres := newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)\n\tres.PreDiagnostics = preErrors\n\tres.PostDiagnostics = postErrors\n\treturn res\n}\n")
old = "type CompilationResult struct {\n\tDiagnostics      []*ast.Diagnostic\n"
assert s.count(old) == 1
s = s.replace(old, "type CompilationResult struct {\n\tPreDiagnostics   []*ast.Diagnostic\n\tPostDiagnostics  []*ast.Diagnostic\n\tDiagnostics      []*ast.Diagnostic\n")
open(p, "w").write(s)

p = root + "/internal/testrunner/compiler_runner.go"
s = open(p).read()
old = "\t\ttsbaseline.DoErrorBaseline(t, c.configuredName, files, diagnostics, c.result.Options.Pretty.IsTrue(), baseline.Options{\n"
assert s.count(old) == 1
new = '''		if dir := os.Getenv("OE_PREPOST_DIR"); dir != "" {
			keep := func(ds []*ast.Diagnostic) []*ast.Diagnostic {
				if contentMapped := c.contentMappedFileNames(); len(contentMapped) > 0 {
					return core.Filter(ds, func(d *ast.Diagnostic) bool {
						return d.File() == nil || !contentMapped[d.File().FileName()]
					})
				}
				return ds
			}
			render := func(ds []*ast.Diagnostic) string {
				if len(ds) == 0 {
					return baseline.NoContent
				}
				return tsbaseline.GetErrorBaseline(t, files, diagnosticwriter.WrapASTDiagnostics(ds), diagnosticwriter.CompareASTDiagnostics, c.result.Options.Pretty.IsTrue())
			}
			pre := render(keep(c.result.PreDiagnostics))
			post := render(keep(c.result.PostDiagnostics))
			used := render(diagnostics)
			stem := oeTsExtension.ReplaceAllString(c.configuredName, ".errors.txt")
			oeMu.Lock()
			f, err := os.OpenFile(filepath.Join(dir, "run.tsv"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err == nil {
				fmt.Fprintf(f, "%s\\t%s\\t%d\\t%d\\t%d\\t%v\\t%v\\n", suiteName, c.configuredName, len(c.result.PreDiagnostics), len(c.result.PostDiagnostics), len(diagnostics), pre == post, used == post)
				f.Close()
			}
			oeMu.Unlock()
			if pre != post || used != post {
				_ = os.MkdirAll(filepath.Join(dir, suiteName), 0o755)
				_ = os.WriteFile(filepath.Join(dir, suiteName, stem+".pre"), []byte(pre), 0o644)
				_ = os.WriteFile(filepath.Join(dir, suiteName, stem+".post"), []byte(post), 0o644)
				_ = os.WriteFile(filepath.Join(dir, suiteName, stem+".used"), []byte(used), 0o644)
			}
		}
'''
s = s.replace(old, new + old)
assert '"github.com/microsoft/typescript-go/internal/diagnosticwriter"' not in s
s = s.replace("import (\n", 'import (\n\t"sync"\n\t"github.com/microsoft/typescript-go/internal/diagnosticwriter"\n', 1)
s = s.replace("// Posix-style path to sources under test", "var oeMu sync.Mutex\nvar oeTsExtension = regexp.MustCompile(`\\.tsx?$`)\n\n// Posix-style path to sources under test", 1)
open(p, "w").write(s)
print("patched", root)
