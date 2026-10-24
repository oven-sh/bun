#!/usr/bin/env python3
"""bang_index.py <bun> <work folder whose tsconfig.json has noUncheckedIndexedAccess> <file name> [namespace]
A project may check with noUncheckedIndexedAccess, under which `a[i]` is `T | undefined`. Full types are npm's code: it cannot add a test. Where the checker then reports an error,
`!` is written behind the element read that the value came from: on the line of the error, or on the line that gave the named variable its value. `!` checks nothing and means nothing without the option.
Rewrites the file. Prints what is left."""
import re, subprocess, sys
bun, work, name = sys.argv[1:4]; NS = sys.argv[4] if len(sys.argv) > 4 else 'RR'
path = work + '/' + name
STYLE = {'TS7029', 'TS7030', 'TS4111', 'TS4114', 'TS6133'}   # a build drops these in full types


def check():
    r = subprocess.run([bun, 'check', '--all', '--no-pretty'], cwd=work, capture_output=True, text=True)
    return [(int(m.group(1)) - 1, int(m.group(2)) - 1, m.group(3), m.group(4)) for m in re.finditer(r'^' + re.escape(name) + r'\((\d+),(\d+)\): error (TS\d+): (.*)$', r.stdout + r.stderr, flags=re.M) if m.group(3) not in STYLE]


def bang_line(line):
    out = []; i = 0; n = len(line); changed = 0
    while i < n:
        c = line[i]
        if c in '"\'`':
            j = i + 1
            while j < n and line[j] != c: j += 2 if line[j] == '\\' else 1
            out.append(line[i:j + 1]); i = j + 1; continue
        if c == '[':
            before = ''.join(out).rstrip()
            if before and re.search(r'[\w$)\]!]$', before) and not re.search(r'\b(return|typeof|in|of|case|void|delete|new|as)$', before):
                depth = 0; j = i
                while j < n:
                    if line[j] in '"\'':
                        q = line[j]; j += 1
                        while j < n and line[j] != q: j += 2 if line[j] == '\\' else 1
                    elif line[j] == '[': depth += 1
                    elif line[j] == ']':
                        depth -= 1
                        if depth == 0: break
                    j += 1
                inner = line[i + 1:j].strip() if j < n else ''
                chain = re.search(r'[\w$.]+$', before)
                in_type = bool(chain and chain.group(0).startswith(NS + '.')) or re.search(r'>$', before)
                rest = line[j + 1:].lstrip() if j < n else ''
                indirect = rest.startswith(')') and re.search(r'\(0, [^()]*(\([^()]*\))?$', before)   # `(0, a[i])()`: the checker knows the form only with a plain access in it
                deleted = re.search(r'\bdelete\b[^,;]*$', before)   # `delete a[i]` reads nothing
                if j < n and inner and not in_type and not indirect and not deleted and not rest.startswith('!') and not re.match(r'=(?!=)', rest):
                    out.append(bang_line(line[i:j])[0] if '[' in line[i + 1:j] else line[i:j]); out.append(']!'); i = j + 1; changed += 1; continue
        out.append(c); i += 1
    return ''.join(out), changed


history = []
for turn in range(8):
    errors = check(); history.append(len(errors))
    if not errors: break
    L = open(path).read().split('\n')
    lines = set()
    for ln, col, code, msg in errors:
        lines.add(ln)
        m = re.compile(r'[A-Za-z_$][\w$]*').match(L[ln], col)
        named = re.match(r"'([\w$]+)' is possibly", msg)
        v = named.group(1) if named else (m.group(0) if m else None)
        if v:
            for back in range(ln, max(-1, ln - 80), -1):
                if re.search(r'(?<![\w$.])' + re.escape(v) + r'(\s*:[^=;]*)?\s*=(?!=)[^;]*\]', L[back]): lines.add(back); break
    changed = 0
    for ln in lines:
        L[ln], c = bang_line(L[ln]); changed += c
    open(path, 'w').write('\n'.join(L))
    if not changed: break
errors = check(); history.append(len(errors))
print('bang_index: errors by turn:', history)
for e in errors[:40]: print('  %d,%d %s %s' % (e[0] + 1, e[1] + 1, e[2], e[3][:170]))
