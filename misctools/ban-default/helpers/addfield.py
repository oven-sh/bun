#!/usr/bin/env python3
"""addfield.py FILE STRUCT FIELD VALUE : adds `FIELD: VALUE,` to the `new()`/`init()`/`empty()` literal of `impl STRUCT`
at the place that the struct declaration gives it."""
import re, sys
f, struct, field, value = sys.argv[1:5]
ctor = sys.argv[5] if len(sys.argv) > 5 else None
s = open(f).read()
names = []
for m in re.finditer(r'(?m)^([ \t]*)(?:pub(?:\([^)]*\))? )?struct ' + re.escape(struct) + r'\b[^;{]*\{', s):
    i = m.end(); depth = 1; j = i
    while depth:
        c = s[j]
        if c == '{': depth += 1
        elif c == '}': depth -= 1
        j += 1
    body = s[i:j-1]
    findent = m.group(1) + '    '
    names = []
    for line in body.split('\n'):
        mm = re.match(re.escape(findent) + r'(?:pub(?:\([^)]*\))?\s+)?(r#)?([a-z_][a-z0-9_]*)\s*:', line)
        if mm:
            names.append(mm.group(2))
    if field in names:
        break
assert field in names, (field, names)
idx = names.index(field)
prev = names[idx-1] if idx > 0 else None
# find the constructor literal
pat = r'impl(?:<[^>]*>)?\s+' + re.escape(struct) + r'\b[^{]*\{'
best = None
for im in re.finditer(pat, s):
    k = im.end()
    cm = re.compile(r'fn\s+(' + (re.escape(ctor) if ctor else r'new|init|empty|none') + r')\s*(?:<[^>]*>)?\s*\([^)]*\)\s*->\s*(?:Self|' + re.escape(struct) + r')[^{]*\{').search(s, k)
    if cm and (best is None or cm.start() < best.start()):
        # must be inside this impl: crude check that no other `impl ` in between
        if 'impl ' not in s[k:cm.start()].replace('impl Fn', ''):
            best = cm
assert best, 'constructor not found'
k = best.end()
lit = re.compile(r'(?:Self|' + re.escape(struct) + r')\s*\{').search(s, k)
assert lit
a = lit.end(); depth = 1; b = a
while depth:
    c = s[b]
    if c == '{': depth += 1
    elif c == '}': depth -= 1
    b += 1
litbody = s[a:b-1]
assert not re.search(r'(?m)^\s*' + re.escape(field) + r'\s*[:,]', litbody), 'field already there'
lines = litbody.split('\n')
indent = None
for line in lines:
    mm = re.match(r'(\s+)[a-z_#]', line)
    if mm: indent = mm.group(1); break
newline = f'{indent}{field}: {value},'
pos = None
if prev:
    d = 0
    for n, line in enumerate(lines):
        if d == 0 and re.match(r'\s*(?:#\[[^\]]*\]\s*)?' + re.escape(prev) + r'\s*[:,]', line):
            # find the end of this field's initializer
            e = n; dd = 0
            while True:
                dd += sum(lines[e].count(c) for c in '([{') - sum(lines[e].count(c) for c in ')]}')
                if dd <= 0 and lines[e].rstrip().endswith(','): break
                e += 1
            pos = e + 1
            break
        d += sum(line.count(c) for c in '([{') - sum(line.count(c) for c in ')]}')
if pos is None:
    # first field, or previous not found: put it first / last
    pos = 1 if prev is None else len(lines) - 1
lines.insert(pos, newline)
s = s[:a] + '\n'.join(lines) + s[b-1:]
open(f, 'w').write(s)
print(f'{f}: {struct}.{field} after {prev}')
