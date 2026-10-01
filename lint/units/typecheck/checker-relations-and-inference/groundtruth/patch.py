# Adds the recording calls to the COPIES of checker.go, relater.go and inference.go inside the probe module. Never run on the reference.
import sys
d = sys.argv[1]
def edit(name, pairs):
    p = d + '/' + name
    s = open(p).read()
    for a, b in pairs:
        if a not in s:
            sys.exit(name + ": pattern not found: " + a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)
edit('checker.go', [
    ("\tif b.overflowBuffer == nil {\n\t\treturn CacheHashKey(xxh3.Hash128(b.inlineBuffer[:b.inlineLength]))\n\t}\n\treturn CacheHashKey(xxh3.Hash128(append(b.overflowBuffer, b.inlineBuffer[:b.inlineLength]...)))\n",
     "\tif b.overflowBuffer == nil {\n\t\treturn relRecordKey(CacheHashKey(xxh3.Hash128(b.inlineBuffer[:b.inlineLength])), b.inlineBuffer[:b.inlineLength])\n\t}\n\tall := append(b.overflowBuffer, b.inlineBuffer[:b.inlineLength]...)\n\treturn relRecordKey(CacheHashKey(xxh3.Hash128(all)), all)\n"),
])
edit('relater.go', [
    ("\tr.results[key] = result\n", "\tr.results[key] = result\n\trelRecordSet(r, key, result)\n"),
    ("func (r *Relater) isRelatedToEx(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {",
     "func (r *Relater) isRelatedToEx(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {\n\trelNote(\"isRelatedToEx %s -> %s recursionFlags=%d reportErrors=%v intersectionState=%d\", relTypeString(originalSource), relTypeString(originalTarget), recursionFlags, reportErrors, intersectionState)\n\tresult := r.isRelatedToEx0(originalSource, originalTarget, recursionFlags, reportErrors, headMessage, intersectionState)\n\trelNote(\"isRelatedToEx = %s\", ternaryString(result))\n\treturn result\n}\n\nfunc (r *Relater) isRelatedToEx0(originalSource *Type, originalTarget *Type, recursionFlags RecursionFlags, reportErrors bool, headMessage *diagnostics.Message, intersectionState IntersectionState) Ternary {"),
    ("func (r *Relater) reportError(message *diagnostics.Message, args ...any) {",
     "func (r *Relater) reportError(message *diagnostics.Message, args ...any) {\n\trelNote(\"reportError TS%d args=%q chainDepth=%d\", message.Code(), args, chainDepth(r.errorChain))\n\tdefer func() { relNote(\"chain after reportError: %s\", relChainString(r.errorChain)) }()\n"),
])
edit('inference.go', [
    ("func (c *Checker) inferFromTypes(n *InferenceState, source *Type, target *Type) {",
     "func (c *Checker) inferFromTypes(n *InferenceState, source *Type, target *Type) {\n\trelNote(\"inferFromTypes %s -> %s priority=%d contravariant=%v bivariant=%v inferencePriority=%d\", relTypeString(source), relTypeString(target), n.priority, n.contravariant, n.bivariant, n.inferencePriority)\n"),
    ("\tinference := n.inferences[index]\n\tif inference.inferredType == nil {",
     "\tinference := n.inferences[index]\n\tdefer func() { relNote(\"getInferredType[%d] = %s candidates=%d contraCandidates=%d priority=%d topLevel=%v isFixed=%v\", index, relTypeString(inference.inferredType), len(inference.candidates), len(inference.contraCandidates), inference.priority, inference.topLevel, inference.isFixed) }()\n\tif inference.inferredType == nil {"),
])
