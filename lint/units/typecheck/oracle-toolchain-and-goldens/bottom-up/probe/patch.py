# Makes the patched COPIES of reference files that the overlay of the probe build uses. The reference is only read.
# Every edit is an exact replacement that must match once: a changed reference stops the build instead of drifting.
# usage: python3 patch.py <reference root> <out dir> <instr binary> [all]
#   <instr binary>  tools/instr built with go: adds `defer relEnter("name", line)()` to every function of a file
#   all             instruments every file of internal/checker (the call tree probe), not only relater.go and inference.go
# prints the paths (relative to the reference root) of the files it made below <out dir>
import os, shutil, subprocess, sys

ref, out, instr = sys.argv[1], sys.argv[2], sys.argv[3]
every = len(sys.argv) > 4 and sys.argv[4] == "all"
made = []


def copy(rel):
    dst = os.path.join(out, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(os.path.join(ref, rel), dst)
    if rel not in made:
        made.append(rel)
    return dst


def edit(rel, pairs):
    dst = os.path.join(out, rel)
    if rel not in made:
        copy(rel)
    s = open(dst, encoding="utf-8").read()
    for a, b in pairs:
        if s.count(a) != 1:
            sys.exit("%s: pattern found %d times, expected once: %r" % (rel, s.count(a), a[:80]))
        s = s.replace(a, b)
    open(dst, "w", encoding="utf-8").write(s)


C = "internal/checker/"
# 1. Function entry records. They run before the text edits, as in the relation probe, so that the recorded line
#    numbers are the ones of the reference.
files = ["relater.go", "inference.go"]
if every:
    skip = {"relater.go", "inference.go", "tracer.go", "stringer_generated.go"}
    files += sorted(f for f in os.listdir(os.path.join(ref, C)) if f.endswith(".go") and not f.endswith("_test.go") and f not in skip)
for f in files:
    subprocess.check_call([instr, copy(C + f)])

# 2. checker.go: recording hooks (checker-core-scratch/groundtruth/patch.py, plus the signature hook). Every edit of
#    the three checker files stays on the line it changes, so that the line numbers of a coverage profile of the
#    probe are the ones of the reference (the layer tables of the unit notes are keyed by file and line).
edit(C + "checker.go", [
    ("\tt.checker = c\n\tt.data = data\n", "\tt.checker = c\n\tt.data = data; probeRecordType(c, t)\n"),
    ("\tresult.Flags = flags | ast.SymbolFlagsTransient\n\tresult.Name = name\n\treturn result\n",
     "\tresult.Flags = flags | ast.SymbolFlagsTransient\n\tresult.Name = name; probeRecordSymbol(c, result)\n\treturn result\n"),
    ("\tsig.resolvedMinArgumentCount = -1\n\treturn sig\n", "\tsig.resolvedMinArgumentCount = -1; probeRecordSignature(c, sig)\n\treturn sig\n"),
    ("func (c *Checker) initializeClosures() {", "func (c *Checker) initializeClosures() { probeMark(c, \"after inline part of NewChecker (line 1117)\");"),
    ("func (c *Checker) initializeChecker() {", "func (c *Checker) initializeChecker() { probeMark(c, \"start of initializeChecker\"); defer probeMark(c, \"end of initializeChecker\");"),
    ("\tc.addUndefinedToGlobalsOrErrorOnRedeclaration()\n\tc.valueSymbolLinks.Get(c.undefinedSymbol)",
     "\tprobeMark(c, \"after global merge and global augmentations (line 1349)\"); c.addUndefinedToGlobalsOrErrorOnRedeclaration()\n\tc.valueSymbolLinks.Get(c.undefinedSymbol)"),
    ("\t// Now merge global ambient module declarations\n", "\tprobeMark(c, \"after special types (line 1376)\") // Now merge global ambient module declarations\n"),
    # ... and the bytes of a relation cache key (checker-relations-and-inference/groundtruth/patch.py).
    ("\tif b.overflowBuffer == nil {\n\t\treturn CacheHashKey(xxh3.Hash128(b.inlineBuffer[:b.inlineLength]))\n\t}\n\treturn CacheHashKey(xxh3.Hash128(append(b.overflowBuffer, b.inlineBuffer[:b.inlineLength]...)))\n",
     "\tif b.overflowBuffer == nil {\n\t\treturn relRecordKey(CacheHashKey(xxh3.Hash128(b.inlineBuffer[:b.inlineLength])), b.inlineBuffer[:b.inlineLength])\n\t}\n\tall := append(b.overflowBuffer, b.inlineBuffer[:b.inlineLength]...); return relRecordKey(CacheHashKey(xxh3.Hash128(all)), all)\n"),
])

# 3. relater.go and inference.go: notes of the relation probe.
edit(C + "relater.go", [
    ("\tr.results[key] = result\n", "\tr.results[key] = result; relRecordSet(r, key, result)\n"),
    ("func (r *Relater) isRelatedToEx(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {",
     "func (r *Relater) isRelatedToEx(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary { relNote(\"isRelatedToEx %s -> %s recursionFlags=%d reportErrors=%v intersectionState=%d\", relTypeString(originalSource), relTypeString(originalTarget), recursionFlags, reportErrors, intersectionState); result := r.isRelatedToEx0(originalSource, originalTarget, recursionFlags, reportErrors, headMessage, intersectionState); relNote(\"isRelatedToEx = %s\", ternaryString(result)); return result }; func (r *Relater) isRelatedToEx0(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {"),
    ("func (r *Relater) reportError(message *diagnostics.Message, args ...any) {",
     "func (r *Relater) reportError(message *diagnostics.Message, args ...any) { relNote(\"reportError TS%d args=%q chainDepth=%d\", message.Code(), args, chainDepth(r.errorChain)); defer func() { relNote(\"chain after reportError: %s\", relChainString(r.errorChain)) }();"),
])
edit(C + "inference.go", [
    ("func (c *Checker) inferFromTypes(n *InferenceState, source *Type, target *Type) {",
     "func (c *Checker) inferFromTypes(n *InferenceState, source *Type, target *Type) { relNote(\"inferFromTypes %s -> %s priority=%d contravariant=%v bivariant=%v inferencePriority=%d\", relTypeString(source), relTypeString(target), n.priority, n.contravariant, n.bivariant, n.inferencePriority);"),
    ("\tinference := n.inferences[index]\n\tif inference.inferredType == nil {",
     "\tinference := n.inferences[index]; defer func() { relNote(\"getInferredType[%d] = %s candidates=%d contraCandidates=%d priority=%d topLevel=%v isFixed=%v\", index, relTypeString(inference.inferredType), len(inference.candidates), len(inference.contraCandidates), inference.priority, inference.topLevel, inference.isFixed) }()\n\tif inference.inferredType == nil {"),
])

# 4. The test harness: the diagnostics-only modes (checker-type-printer/bottom-up/groundtruth/patch.py) and the
#    recorder of the program of every run instance (drivers-k4-k5/bottom-up/groundtruth/k5/patch3.py).
H = "internal/testutil/harnessutil/harnessutil.go"
edit(H, [
    ("\tctx := context.Background()\n\n\tvar preErrors []*ast.Diagnostic\n",
     '''	ctx := context.Background()

	if strings.HasPrefix(os.Getenv("CTP_MODE"), "diag") {
		diagProgram := createProgram(host, config)
		var diagErrors []*ast.Diagnostic
		diagErrors = append(diagErrors, diagProgram.GetConfigFileParsingDiagnostics()...)
		diagErrors = append(diagErrors, diagProgram.GetProgramDiagnostics()...)
		diagErrors = append(diagErrors, diagProgram.GetSyntacticDiagnostics(ctx, nil)...)
		diagErrors = append(diagErrors, diagProgram.GetSemanticDiagnostics(ctx, nil)...)
		diagErrors = append(diagErrors, diagProgram.GetGlobalDiagnostics(ctx)...)
		if os.Getenv("CTP_MODE") == "diagdecl" && diagProgram.Options().GetEmitDeclarations() {
			diagErrors = append(diagErrors, diagProgram.GetDeclarationDiagnostics(ctx, nil)...)
		}
		if harnessOptions.CaptureSuggestions {
			diagErrors = append(diagErrors, diagProgram.GetSuggestionDiagnostics(ctx, nil)...)
		}
		diagErrors = compiler.SortAndDeduplicateDiagnostics(diagErrors)
		return newCompilationResult(host, config.CompilerOptions(), diagProgram, nil, diagErrors, harnessOptions)
	}

	var preErrors []*ast.Diagnostic
'''),
    ("\tif config.CompilerOptions().Incremental.IsTrue() {\n\t\toldProgram := incremental.ReadBuildInfoProgram",
     "\tif !strings.HasPrefix(os.Getenv(\"CTP_MODE\"), \"diag\") && config.CompilerOptions().Incremental.IsTrue() {\n\t\toldProgram := incremental.ReadBuildInfoProgram"),
    ("\treturn newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)\n}\n",
     '''	res := newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)
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
'''),
    ("type CompilationResult struct {\n\tDiagnostics      []*ast.Diagnostic\n",
     "type CompilationResult struct {\n\tK5               map[string][]*ast.Diagnostic\n\tK5Pre            int\n\tK5Post           int\n\tDiagnostics      []*ast.Diagnostic\n"),
])
R = "internal/testrunner/compiler_runner.go"
edit(R, [
    ("\tcompilerTest.verifyDiagnostics(t, r.testSuitName, r.isSubmodule)\n\tcompilerTest.verifyContentMapper",
     "\tcompilerTest.verifyDiagnostics(t, r.testSuitName, r.isSubmodule)\n\tif strings.HasPrefix(os.Getenv(\"CTP_MODE\"), \"diag\") {\n\t\treturn\n\t}\n\tcompilerTest.verifyContentMapper"),
    ("\tharnessutil.SkipUnsupportedCompilerOptions(t, compilerTest.options)\n",
     "\tharnessutil.SkipUnsupportedCompilerOptions(t, compilerTest.options)\n\tk5Record(r.testSuitName, compilerTest)\n"),
])

# 5. The repository root of the harness: local baselines go below TSGOPROBE_ROOT, never into the reference.
edit("internal/repo/paths.go", [
    ("var rootPath = sync.OnceValue(func() string {\n", "var rootPath = sync.OnceValue(func() string {\n\tif p := os.Getenv(\"TSGOPROBE_ROOT\"); p != \"\" {\n\t\treturn p\n\t}\n"),
])

print("\n".join(made))
