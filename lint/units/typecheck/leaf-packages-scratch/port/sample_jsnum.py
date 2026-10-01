#!/usr/bin/env python3
# Samples the golden vector files of ../golden/run.sh (vectors_126.tsv, vectors2.tsv, vectors4.tsv in <golden dir>)
# into the test vectors of src/typecheck/jsnum/testdata: every F line, the S lines of the strings and of the special
# values, one random S line in 100 (vectors_126) and one in 3000 (vectors2), the first 400 B and N lines, the first 642
# P lines (special cases and integer exponents) and the first 600 P lines of vectors4 (fractional exponents).
# usage: sample_jsnum.py <golden dir> <testdata dir>
import sys

golden, out = sys.argv[1], sys.argv[2]
lines = open(golden + "/vectors_126.tsv").read().split("\n")
arithmetic = open(out + "/arithmetic.tsv", "w")
strings = open(out + "/string.tsv", "w")
counts = {}
for line in lines:
    kind = line.split("\t", 1)[0]
    counts[kind] = counts.get(kind, 0) + 1
    if kind == "F":
        strings.write(line + "\n")
    elif kind in ("B", "N") and counts[kind] <= 400:
        arithmetic.write(line + "\n")
    elif kind == "P" and counts[kind] <= 642:
        arithmetic.write(line + "\n")
last_f = max(i for i, l in enumerate(lines) if l.startswith("F\t"))
first_b = min(i for i, l in enumerate(lines) if l.startswith("B\t"))
before = [l for l in lines[: last_f + 1] if l.startswith("S\t")]
after = [l for l in lines[last_f + 1 : first_b] if l.startswith("S\t")]
for line in before + after[:40] + after[40::100]:
    strings.write(line + "\n")
for i, line in enumerate(open(golden + "/vectors2.tsv")):
    if i % 3000 == 0:
        strings.write(line)
for i, line in enumerate(open(golden + "/vectors4.tsv")):
    if i < 600:
        arithmetic.write(line)
