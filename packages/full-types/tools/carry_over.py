#!/usr/bin/env python3
"""carry_over.py <typed.cts> <original.js> <patched.js> <merged.cts out>: what a patch changed in npm's text, laid into the typed text, BY LINE: the typed text is line for line npm's, behind its leading `/// <reference` lines (the annotators insert no newline: asserted here).
A line the patch leaves alone keeps its types. A line the patch adds comes in as it is, unannotated. A line the patch takes away goes. A LINE THE PATCH REPLACES: THE PATCH's LINE IS TAKEN; where the typed line carried an annotation THE TYPES OF THAT LINE ARE LOST and its number in the merged text is printed: write them back by hand if the check or verify complains.
(macOS's diff3 -m doubled a stretch of 18 lines and said "no conflict": it is not used.)
PRINTS COUNTS AND LINE NUMBERS ONLY: nothing of any text."""
import difflib, re, sys
typed, original, patched = (open(p).read().rstrip("\n").split("\n") for p in sys.argv[1:4])
head = 0
while head < len(typed) and re.fullmatch(r"(\s*///\s*<reference path=\"[^\"]+\"\s*/>\s*)+", typed[head]): head += 1
body = typed[head:]
if len(body) != len(original): sys.exit("carry_over: the typed text has %d lines behind its %d references, npm's has %d: not line for line" % (len(body), head, len(original)))
out = typed[:head]; kept = added = gone = plain = 0; lost = []
for op, a, b, c, d in difflib.SequenceMatcher(None, original, patched, autojunk=False).get_opcodes():
    if op == "equal": out += body[a:b]; kept += b - a
    elif op == "insert": out += patched[c:d]; added += d - c
    elif op == "delete": gone += b - a
    else:
        carried = [i for i in range(a, b) if body[i] != original[i]]
        if carried: lost.append((len(out) + 1, len(out) + (d - c), len(carried)))
        else: plain += 1
        out += patched[c:d]
open(sys.argv[4], "w").write("\n".join(out) + "\n")
print("lines kept with their types %d · added by the patch %d · taken away %d · stretches replaced that carried no annotation %d · STRETCHES REPLACED WHOSE TYPES ARE LOST %d%s" % (kept, added, gone, plain, len(lost), (": merged.cts " + ", ".join("%d..%d (%d typed lines)" % x for x in lost) if lost else "")))
