#!/usr/bin/env python3
"""Simulates the test the_lint_twin_of_parse_paren_expr_reads_what_it_reads on the working tree."""
import re, sys
src = open('/workspace/wt/parser/src/js_parser/parse/mod.rs','rb').read()
test = open('/workspace/wt/parser/src/js_parser/parse/annotation_tests.rs').read()
def function_lines(head):
    lines = []; inside = False
    for line in src.split(b"\n"):
        if not inside:
            inside = line == head
            continue
        if line == b"    }":
            break
        t = line.strip(b" \t\r\n\x0c")
        if t and not t.startswith(b"//"):
            lines.append(t)
    return lines
original = function_lines(b"    pub(crate) fn parse_paren_expr(")
twin = function_lines(b"    pub(crate) fn parse_paren_expr_for_lint(")
# read TWIN_DIFFERENCES out of the Rust test source
m = re.search(r'const TWIN_DIFFERENCES: .*? = &\[(.*?)\n\];', test, re.S)
body = m.group(1)
# split top-level tuples
tuples = []; depth = 0; cur = ''
i = 0
while i < len(body):
    ch = body[i]
    if ch == 'b' and body[i+1] == '"':
        j = i + 2
        while body[j] != '"':
            if body[j] == '\\': j += 1
            j += 1
        cur += body[i:j+1]; i = j + 1; continue
    if ch == '(' : depth += 1
    if ch == ')' : depth -= 1
    cur += ch
    if depth == 0 and ch == ')':
        tuples.append(cur); cur = ''
    i += 1
diffs = []
for t in tuples:
    # two slices: &[...], &[...]
    parts = []
    k = t.index('&[')
    for _ in range(2):
        k = t.index('&[', k)
        d = 0; j = k + 1
        while True:
            if t[j] == '[': d += 1
            elif t[j] == ']':
                d -= 1
                if d == 0: break
            elif t[j] == '"':
                j += 1
                while t[j] != '"':
                    if t[j] == '\\': j += 1
                    j += 1
            j += 1
        inner = t[k+2:j]
        strs = [bytes(s, 'utf8').decode('unicode_escape').encode() for s in re.findall(r'b"((?:[^"\\]|\\.)*)"', inner)]
        parts.append(strs); k = j
    diffs.append(parts)
print(len(diffs), 'differences')
uses = [0]*len(diffs); expected = []; at = 0
while at < len(original):
    rest = original[at:]
    hit = None
    for n,(frm,to) in enumerate(diffs):
        if rest[:len(frm)] == frm:
            hit = n; break
    if hit is None:
        expected.append(rest[0]); at += 1
    else:
        expected.extend(diffs[hit][1]); uses[hit] += 1; at += len(diffs[hit][0])
print('uses', uses)
print('equal', expected == twin, len(expected), len(twin))
for a,b in zip(expected, twin):
    if a != b:
        print('first difference:', a, '|', b); break
