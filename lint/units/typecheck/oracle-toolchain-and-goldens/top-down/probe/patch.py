# Writes the patched COPIES of reference files that the overlay of the probe build uses, and the overlay itself.
# The reference tree is only read. Every pattern must match exactly once, or the script stops.
# usage: python3 patch.py <reference root> <probe dir> <out dir> <plain|trace> [instr binary for trace]
# plain: creation records in newType, newSymbol and newSignature, marks in NewChecker (all on existing lines, so that
#        line numbers of checker.go stay those of the reference), an optional scratch root for the test harness,
#        the diagnostics-only modes and the program recorder of the harness.
# trace: plain, plus an entry record in every function of internal/checker and the notes of the relater and of inference.
import json, os, shutil, subprocess, sys

ref, probe, out, flavour = sys.argv[1:5]
instr = sys.argv[5] if len(sys.argv) > 5 else None
gen = os.path.join(out, 'gen')
shutil.rmtree(gen, ignore_errors=True)
overlay = {}


def load(rel):
    p = os.path.join(gen, rel)
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(os.path.join(ref, rel), encoding='utf-8') as f:
            s = f.read()
        with open(p, 'w', encoding='utf-8') as f:
            f.write(s)
    overlay[os.path.join(ref, rel)] = p
    with open(p, encoding='utf-8') as f:
        return f.read()


def edit(rel, pairs):
    s = load(rel)
    for a, b in pairs:
        if s.count(a) != 1:
            sys.exit('%s: pattern found %d times: %r' % (rel, s.count(a), a[:70]))
        s = s.replace(a, b)
    with open(os.path.join(gen, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def line_count(rel):
    with open(os.path.join(gen, rel), encoding='utf-8') as f:
        a = f.read().count('\n')
    with open(os.path.join(ref, rel), encoding='utf-8') as f:
        b = f.read().count('\n')
    return a - b


CH = 'internal/checker/'
if flavour == 'trace':
    if not instr:
        sys.exit('trace needs the instr binary')
    for name in sorted(os.listdir(os.path.join(ref, CH))):
        if not name.endswith('.go') or name.endswith('_test.go') or name in ('tracer.go', 'stringer_generated.go'):
            continue
        load(CH + name)
        fn = 'relEnter' if name in ('relater.go', 'inference.go') else 'relEnterAll'
        subprocess.check_call([instr, '-fn=' + fn, os.path.join(gen, CH + name)])

# Creation records and marks (checker-core-scratch/groundtruth/patch.py, kept on the existing lines).
edit(CH + 'checker.go', [
    ('\tt.checker = c\n\tt.data = data\n', '\tt.checker = c\n\tt.data = data; probeRecordType(c, t)\n'),
    ('\tresult.Flags = flags | ast.SymbolFlagsTransient\n\tresult.Name = name\n\treturn result\n',
     '\tresult.Flags = flags | ast.SymbolFlagsTransient\n\tresult.Name = name; probeRecordSymbol(c, result)\n\treturn result\n'),
    ('\tsig.resolvedMinArgumentCount = -1\n\treturn sig\n', '\tsig.resolvedMinArgumentCount = -1; probeRecordSignature(c, sig)\n\treturn sig\n'),
    ('\tc.addUndefinedToGlobalsOrErrorOnRedeclaration()\n\tc.valueSymbolLinks.Get(c.undefinedSymbol)',
     '\tprobeMark(c, "after global merge and global augmentations (line 1349)"); c.addUndefinedToGlobalsOrErrorOnRedeclaration()\n\tc.valueSymbolLinks.Get(c.undefinedSymbol)'),
    ('\t// Now merge global ambient module declarations\n',
     '\tprobeMark(c, "after special types (line 1376)") // Now merge global ambient module declarations\n'),
])
if flavour == 'trace':
    # instr has already put its record after the brace of these two functions
    edit(CH + 'checker.go', [
        ('func (c *Checker) initializeClosures() {', 'func (c *Checker) initializeClosures() { probeMark(c, "after inline part of NewChecker (line 1117)");'),
        ('func (c *Checker) initializeChecker() {', 'func (c *Checker) initializeChecker() { probeMark(c, "start of initializeChecker"); defer probeMark(c, "end of initializeChecker");'),
    ])
else:
    edit(CH + 'checker.go', [
        ('func (c *Checker) initializeClosures() {\n', 'func (c *Checker) initializeClosures() { probeMark(c, "after inline part of NewChecker (line 1117)")\n'),
        ('func (c *Checker) initializeChecker() {\n', 'func (c *Checker) initializeChecker() { probeMark(c, "start of initializeChecker"); defer probeMark(c, "end of initializeChecker")\n'),
    ])
# The one list that the reference builds in the iteration order of a Go map and never sorts: the infer type parameters of
# a conditional type (checker.go 23919). The order does not reach any output of the reference, but it reaches the state
# dump (outerTypeParameters, mappers). The probe builds the list in declaration order, which is one of the orders the
# reference can take and the one a port with insertion ordered tables takes.
edit(CH + 'checker.go', [
    ('\tfor _, symbol := range node.Locals() {\n\t\tif symbol.Flags&ast.SymbolFlagsTypeParameter != 0 {\n\t\t\tresult = append(result, c.getDeclaredTypeOfSymbol(symbol))',
     '\tfor _, symbol := range probeSortedLocals(node.Locals()) {\n\t\tif symbol.Flags&ast.SymbolFlagsTypeParameter != 0 {\n\t\t\tresult = append(result, c.getDeclaredTypeOfSymbol(symbol))'),
])
if line_count(CH + 'checker.go') != 0:
    sys.exit('checker.go: the record patches changed the line count')

if flavour == 'trace':
    # checker-relations-and-inference/groundtruth/patch.py, unchanged (these add lines, after instr took its line numbers).
    edit(CH + 'checker.go', [
        ("\tif b.overflowBuffer == nil {\n\t\treturn CacheHashKey(xxh3.Hash128(b.inlineBuffer[:b.inlineLength]))\n\t}\n\treturn CacheHashKey(xxh3.Hash128(append(b.overflowBuffer, b.inlineBuffer[:b.inlineLength]...)))\n",
         "\tif b.overflowBuffer == nil {\n\t\treturn relRecordKey(CacheHashKey(xxh3.Hash128(b.inlineBuffer[:b.inlineLength])), b.inlineBuffer[:b.inlineLength])\n\t}\n\tall := append(b.overflowBuffer, b.inlineBuffer[:b.inlineLength]...)\n\treturn relRecordKey(CacheHashKey(xxh3.Hash128(all)), all)\n"),
    ])
    edit(CH + 'relater.go', [
        ("\tr.results[key] = result\n", "\tr.results[key] = result\n\trelRecordSet(r, key, result)\n"),
        ("func (r *Relater) isRelatedToEx(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {",
         "func (r *Relater) isRelatedToEx(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {\n\trelNote(\"isRelatedToEx %s -> %s recursionFlags=%d reportErrors=%v intersectionState=%d\", relTypeString(originalSource), relTypeString(originalTarget), recursionFlags, reportErrors, intersectionState)\n\tresult := r.isRelatedToEx0(originalSource, originalTarget, recursionFlags, reportErrors, headMessage, intersectionState)\n\trelNote(\"isRelatedToEx = %s\", ternaryString(result))\n\treturn result\n}\n\nfunc (r *Relater) isRelatedToEx0(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {"),
        ("func (r *Relater) reportError(message *diagnostics.Message, args ...any) {",
         "func (r *Relater) reportError(message *diagnostics.Message, args ...any) {\n\trelNote(\"reportError TS%d args=%q chainDepth=%d\", message.Code(), args, chainDepth(r.errorChain))\n\tdefer func() { relNote(\"chain after reportError: %s\", relChainString(r.errorChain)) }()\n"),
    ])
    edit(CH + 'inference.go', [
        ("func (c *Checker) inferFromTypes(n *InferenceState, source *Type, target *Type) {",
         "func (c *Checker) inferFromTypes(n *InferenceState, source *Type, target *Type) {\n\trelNote(\"inferFromTypes %s -> %s priority=%d contravariant=%v bivariant=%v inferencePriority=%d\", relTypeString(source), relTypeString(target), n.priority, n.contravariant, n.bivariant, n.inferencePriority)\n"),
        ("\tinference := n.inferences[index]\n\tif inference.inferredType == nil {",
         "\tinference := n.inferences[index]\n\tdefer func() { relNote(\"getInferredType[%d] = %s candidates=%d contraCandidates=%d priority=%d topLevel=%v isFixed=%v\", index, relTypeString(inference.inferredType), len(inference.candidates), len(inference.contraCandidates), inference.priority, inference.topLevel, inference.isFixed) }()\n\tif inference.inferredType == nil {"),
    ])

# The test harness writes baselines below the repository root: let a run name a scratch root instead.
edit('internal/repo/paths.go', [
    ('var rootPath = sync.OnceValue(func() string {\n',
     'var rootPath = sync.OnceValue(func() string {\n\tif r := os.Getenv("ORACLE_REPO_ROOT"); r != "" {\n\t\treturn r\n\t}\n'),
])

# checker-type-printer/bottom-up/groundtruth/patch.py: the diagnostics-only modes of the harness (CTP_MODE=diag|diagdecl).
H = 'internal/testutil/harnessutil/harnessutil.go'
R = 'internal/testrunner/compiler_runner.go'
edit(H, [
    ('''	ctx := context.Background()

	var preErrors []*ast.Diagnostic
''', '''	ctx := context.Background()

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
    ('	if config.CompilerOptions().Incremental.IsTrue() {\n		oldProgram := incremental.ReadBuildInfoProgram',
     '	if !strings.HasPrefix(os.Getenv("CTP_MODE"), "diag") && config.CompilerOptions().Incremental.IsTrue() {\n		oldProgram := incremental.ReadBuildInfoProgram'),
])
edit(R, [
    ('''	compilerTest.verifyDiagnostics(t, r.testSuitName, r.isSubmodule)
	compilerTest.verifyContentMapper''', '''	compilerTest.verifyDiagnostics(t, r.testSuitName, r.isSubmodule)
	if strings.HasPrefix(os.Getenv("CTP_MODE"), "diag") {
		return
	}
	compilerTest.verifyContentMapper'''),
])

# drivers-k4-k5/bottom-up/groundtruth/k5/patch3.py: the program recorder of the harness (K5_MANIFEST_DIR).
edit(H, [
    ("\treturn newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)\n}\n", '''	res := newCompilationResult(host, config.CompilerOptions(), postProgram, emitResult, errors, harnessOptions)
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
edit(R, [
    ("\tharnessutil.SkipUnsupportedCompilerOptions(t, compilerTest.options)\n",
     "\tharnessutil.SkipUnsupportedCompilerOptions(t, compilerTest.options)\n\tk5Record(r.testSuitName, compilerTest)\n"),
])

# Files that exist only in the overlay: the hooks inside the reference's packages and the probe program itself.
src = os.path.join(probe, 'overlay')
for d, _, files in os.walk(src):
    for f in files:
        if f.endswith('.go'):
            overlay[os.path.join(ref, os.path.relpath(os.path.join(d, f), src))] = os.path.join(d, f)
overlay[os.path.join(ref, 'cmd/oracle/main.go')] = os.path.join(probe, 'main.go')
sub = os.path.join(probe, 'sub')
for d, _, files in os.walk(sub):
    for f in files:
        if f.endswith('.go'):
            overlay[os.path.join(ref, 'cmd/oracle', os.path.relpath(os.path.join(d, f), sub))] = os.path.join(d, f)
# diagnostics-groundtruth/gt/gen_bycode.mjs: the table from a code to its message, for the diagfmt sub-command.
import re
with open(os.path.join(ref, 'internal/diagnostics/diagnostics_generated.go'), encoding='utf-8') as f:
    pairs = re.findall(r'^var (\w+) = &Message\{code: (-?\d+),', f.read(), re.M)
bycode = os.path.join(gen, 'cmd/oracle/diagfmt/zz_bycode.go')
os.makedirs(os.path.dirname(bycode), exist_ok=True)
with open(bycode, 'w') as f:
    f.write('// generated for the ground-truth probe\npackage diagfmt\n\nimport "github.com/microsoft/typescript-go/internal/diagnostics"\n\nvar byCode = map[int32]*diagnostics.Message{\n')
    for name, code in pairs:
        f.write('\t%s: diagnostics.%s,\n' % (code, name))
    f.write('}\n')
overlay[os.path.join(ref, 'cmd/oracle/diagfmt/zz_bycode.go')] = bycode
print('diagfmt: %d messages by code' % len(pairs))
with open(os.path.join(out, 'overlay.json'), 'w') as f:
    json.dump({'Replace': overlay}, f, indent=1, sort_keys=True)
print('overlay: %d files, %s' % (len(overlay), os.path.join(out, 'overlay.json')))
