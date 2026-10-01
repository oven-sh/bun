# Replay helper: the call tree below the first entry of one function, from a `tsgoprobe-all rel -trace` output, with
# a subtree that repeats folded to its first line with "  x<N>", a repeated pair of sibling subtrees to "[x<N> pair]", as checker-relations-and-inference/
# groundtruth/out/k4.relation-tree.txt has it (the script that made that file was not kept: this one makes the same bytes).
# usage: python3 foldtree.py <trace> <function, e.g. Checker.checkTypeAssignableToAndOptionallyElaborate> [-without <function>]
#        python3 foldtree.py -strip <folded tree file> <function>      the same cut on a stored tree
import sys

if sys.argv[1] == "-strip":
    skip = -1
    for l in open(sys.argv[2]).read().split("\n"):
        ind = len(l) - len(l.lstrip())
        if skip >= 0 and ind > skip:
            continue
        skip = -1
        if l != "":
            print(l)
        if l.strip().split("  x")[0] == sys.argv[3]:
            skip = ind
    sys.exit(0)
lines = [l[2:] for l in open(sys.argv[1]).read().split("\n") if l.startswith("T ")]
start = next(i for i, l in enumerate(lines) if l.strip() == sys.argv[2])
base = len(lines[start]) - len(lines[start].lstrip())
sub = [lines[start][base:]]
for l in lines[start + 1:]:
    if len(l) - len(l.lstrip()) <= base:
        break
    sub.append(l[base:])


def indent(l):
    return len(l) - len(l.lstrip())


def subtree_end(i):
    j = i + 1
    while j < len(sub) and indent(sub[j]) > indent(sub[i]):
        j += 1
    return j


out = []
i = 0
while i < len(sub):
    a_end = subtree_end(i)
    one = sub[i:a_end]
    n = 1
    while sub[i + n * len(one):i + (n + 1) * len(one)] == one:
        n += 1
    if n > 1:
        out.append(one[0] + "  x%d" % n)
        out.extend(one[1:])
        i += n * len(one)
        continue
    if a_end < len(sub) and indent(sub[a_end]) == indent(sub[i]):
        b_end = subtree_end(a_end)
        block = sub[i:b_end]
        n = 1
        while sub[i + n * len(block):i + (n + 1) * len(block)] == block:
            n += 1
        if n > 1:
            out.append(" " * indent(sub[i]) + "[x%d pair]" % n)
            out.extend(block)
            i += n * len(block)
            continue
    out.append(sub[i])
    i += 1
# -without <function>: leaves out the subtree of that function (the calls below getNamedMembers follow the order of a
# Go map and differ in every run, so only the rest of two trees can be compared)
if len(sys.argv) > 4 and sys.argv[3] == "-without":
    kept = []
    skip = -1
    for l in out:
        if skip >= 0 and indent(l) > skip:
            continue
        skip = -1
        kept.append(l)
        if l.strip().split("  x")[0] == sys.argv[4]:
            skip = indent(l)
    out = kept
print("\n".join(out))
