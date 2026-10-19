#!/usr/bin/env python3
"""Reads an error list (file:line:col: error[E0599]: no associated function or constant named `X` found for struct `T...`)
and renames the identifier at that position to `new` when (T, X) is in the merge table."""
import re, sys, collections
ROOT = '/workspace/bun/'
TABLE = {
 'init': ('Stable', 'HashMap', 'StringArrayHashMap', 'StringHashMap', 'Group', 'LineBuffer', 'IdSet', 'IdMap', 'DiscardingWriter', 'IdentifierOpts', 'NodeTags', 'Condition', 'FutexImpl', 'Mutex', 'DebugImpl', 'WindowsImpl', 'DarwinImpl', 'CaseInsensitiveAsciiStringArrayHashMap'),
 'empty': ('StringSet',),
}
pat = re.compile(r'^([^:]+):(\d+):(\d+): error\[E0599\]: no (?:associated function or constant|function or associated item|method) named `(\w+)` found for (?:struct|type alias) `([^`]+)`')
by_file = collections.defaultdict(list)
for line in open(sys.argv[1]):
    m = pat.match(line)
    if not m: continue
    f, ln, col, fn, ty = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4), m.group(5)
    base = re.sub(r'<.*', '', ty).split('::')[-1]
    if fn in TABLE and base in TABLE[fn]:
        by_file[f].append((ln, col, fn))
n = 0
for f, sites in by_file.items():
    lines = open(ROOT + f).read().split('\n')
    for ln, col, fn in sorted(set(sites), reverse=True):
        line = lines[ln - 1]
        # col is 1-based in characters
        i = col - 1
        if line[i:i+len(fn)] == fn:
            lines[ln - 1] = line[:i] + 'new' + line[i+len(fn):]; n += 1
        else:
            print('MISMATCH', f, ln, col, line[i:i+12])
    open(ROOT + f, 'w').write('\n'.join(lines))
print('renamed', n)
