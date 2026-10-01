# Research probe: patches a COPY of typescript-go so that TestSubmodule records the program of every run instance. Never run on the reference.
# usage: python3 patch3.py <copy of typescript-go> <dir of this script>
import sys
root, here = sys.argv[1], sys.argv[2]
p = root + "/internal/testutil/harnessutil/harnessutil.go"
s = open(p).read()
old = "\treturn newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)\n}\n"
assert s.count(old) == 1
new = '''	res := newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)
	if os.Getenv("K5_MANIFEST_DIR") != "" {
		k5 := map[string][]*ast.Diagnostic{
			"config":    postProgram.GetConfigFileParsingDiagnostics(),
			"program":   postProgram.GetProgramDiagnostics(),
			"syntactic": postProgram.GetSyntacticDiagnostics(ctx, nil),
			"semantic":  postProgram.GetSemanticDiagnostics(ctx, nil),
			"global":    postProgram.GetGlobalDiagnostics(ctx),
			"bind":      postProgram.GetBindDiagnostics(ctx, nil),
		}
		if postProgram.Options().GetEmitDeclarations() {
			k5["declaration"] = postProgram.GetDeclarationDiagnostics(ctx, nil)
		}
		if harnessOptions.CaptureSuggestions {
			k5["suggestion"] = postProgram.GetSuggestionDiagnostics(ctx, nil)
		}
		var inc []*ast.Diagnostic
		for _, f := range postProgram.GetSourceFiles() {
			inc = append(inc, postProgram.Program().GetIncludeProcessorDiagnostics(f)...)
		}
		k5["include"] = inc
		res.K5 = k5
		res.K5Pre = len(preErrors)
		res.K5Post = len(postErrors)
	}
	return res
}
'''
s = s.replace(old, new)
old = "type CompilationResult struct {\n\tDiagnostics      []*ast.Diagnostic\n"
assert s.count(old) == 1
s = s.replace(old, "type CompilationResult struct {\n\tK5               map[string][]*ast.Diagnostic\n\tK5Pre            int\n\tK5Post           int\n\tDiagnostics      []*ast.Diagnostic\n")
open(p, "w").write(s)
p = root + "/internal/testrunner/compiler_runner.go"
s = open(p).read()
old = "\tharnessutil.SkipUnsupportedCompilerOptions(t, compilerTest.options)\n"
assert s.count(old) == 1
s = s.replace(old, old + "\tk5Record(r.testSuitName, compilerTest)\n")
open(p, "w").write(s)
open(root + "/internal/testrunner/zz_k5.go", "w").write(open(here + "/zz_k5.go.txt").read())
print("patched", root)
