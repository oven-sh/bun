#!/usr/bin/env python3
"""Reads checker/utilities.rs beside checker/utilities.go and beside the tree. It compiles nothing.
usage: utilities-check.py [crate directory, default src/typecheck of the worktree]   exit 1 when a check prints a line
1. every function of utilities.go has a fn of its name in the file, in upstream's order
2. every imported name is used, and every free function that is called is imported or defined in the file
3. no two comment lines are adjacent, no unwrap, expect, panic, todo, unimplemented, unreachable, unsafe
4. the strings of the feature map are those of utilities.go 1294-1552, in order
5. every call of a pub fn of the file from checker/, evaluator/ and modulespecifiers/ has its number of arguments
6. every call that the file makes has the number of arguments of a definition of that name in the tree"""
import os, re, sys

crate = sys.argv[1] if len(sys.argv) > 1 else '/workspace/wt/typecheck/src/typecheck'
GO = '/workspace/ref/typescript-go/internal/checker/utilities.go'
MINE = os.path.join(crate, 'checker', 'utilities.rs')
bad = False


def report(line):
    global bad
    bad = True
    print(line)


def strip(src):
    """Blanks comments, string literals and character literals."""
    out, i, n = [], 0, len(src)
    while i < n:
        ch = src[i]
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        is_bytes = ch == 'b' and i + 1 < n and src[i + 1] == '"' and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] == '_'))
        if ch == '"' or is_bytes:
            j = i + (2 if is_bytes else 1)
            while j < n and src[j] != '"':
                j += 2 if src[j] == '\\' else 1
            out.append('""')
            i = j + 1
            continue
        if ch == "'":
            m = re.match(r"'(\\.|[^'\\])'", src[i:])
            if m:
                out.append("' '")
                i += m.end()
                continue
        out.append(ch)
        i += 1
    return ''.join(out)


def split_args(s):
    s = re.sub(r'\|[^|]*\|', 'CLOSURE', s)
    depth, cur, out = 0, '', []
    for k, ch in enumerate(s):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def snake(name):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s).lower()


src = open(MINE).read()
plain = strip(src)
lines = src.split('\n')

# 1
go = open(GO).read()
go_names = [m.group(1) for m in re.finditer(r'^func (?:\([a-z]+ \*?[A-Za-z\[\]]+\) )?([A-Za-z0-9_]+)', go, re.M)]
positions = {}
for m in re.finditer(r'fn ([a-z0-9_]+)', plain):
    positions.setdefault(m.group(1), []).append(m.start())
last = -1
for name in go_names:
    s = snake(name)
    candidates = [s, s.replace('js_doc', 'jsdoc').replace('na_n', 'nan')]
    found = [p for c in candidates for p in positions.get(c, [])]
    if not found:
        report(f'1. no fn for {name}')
        continue
    after = [p for p in found if p > last]
    if not after:
        report(f'1. {name} is not in upstream order')
        continue
    last = min(after)
print(f'1. {len(go_names)} functions of utilities.go')

# 2
head_end = plain.index('fn stack_is_safe')
head, body = plain[:head_end], plain[head_end:]
imported = set()
for m in re.finditer(r'^use ([^;]+);', head, re.M | re.S):
    stmt = m.group(1)
    if '{' in stmt:
        prefix, inner = stmt.split('{', 1)
        for n in inner.rsplit('}', 1)[0].split(','):
            n = n.strip()
            if n:
                imported.add(prefix.strip().rstrip(':').split('::')[-1] if n == 'self' else n.split('::')[-1])
    else:
        imported.add(stmt.strip().split('::')[-1])
for n in sorted(imported):
    if not re.search(r'(?<![A-Za-z0-9_])' + re.escape(n) + r'(?![A-Za-z0-9_])', body):
        report(f'2. unused import {n}')
local = set(re.findall(r'fn ([a-z0-9_]+)', plain))
words = {'if', 'while', 'match', 'for', 'return', 'matches', 'loop', 'vec', 'Some', 'Ok', 'derive', 'checker_flags', 'pub'}
closures = set(re.findall(r'(?:let|mut) ([a-z_]+)(?:: impl Fn[A-Za-z]*\([^)]*\)[^,)]*| = \|)', plain))
for m in re.finditer(r'(?<![A-Za-z0-9_.:])([a-z_][a-z0-9_]*)\(', body):
    n = m.group(1)
    if n not in imported and n not in local and n not in words and n not in closures:
        report(f'2. {n} is called and neither imported nor defined')
print(f'2. {len(imported)} imported names')

# 3
for i in range(len(lines) - 1):
    if lines[i].strip().startswith('//') and lines[i + 1].strip().startswith('//'):
        report(f'3. two comment lines at {i + 1}')
for pattern in [r'\.unwrap\(\)', r'\.expect\(', r'panic!', r'todo!', r'unimplemented!', r'unreachable!', r'\bunsafe\b']:
    for i, line in enumerate(plain.split('\n')):
        if re.search(pattern, line):
            report(f'3. {pattern} at {i + 1}')
print('3. comments and forbidden calls')

# 4
go_lines = go.split('\n')
first = next(i for i, l in enumerate(go_lines) if 'var getFeatureMap' in l)
end = next(i for i, l in enumerate(go_lines) if i > first and l.startswith('})'))
go_strings = re.findall(r'"([^"]*)"', '\n'.join(go_lines[first + 1:end]))
start = src.index('const FEATURES')
mine_strings = re.findall(r'b"([^"]*)"', src[start:src.index('\n];', start)])
if go_strings != mine_strings:
    report(f'4. the feature map differs: {len(go_strings)} strings upstream, {len(mine_strings)} here')
print(f'4. {len(mine_strings)} strings of the feature map')

# 5
mine_sigs = {}
for m in re.finditer(r'^( *)pub fn ([a-z0-9_]+)(?:<[^>]*>)?\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)', plain, re.M):
    ps = split_args(m.group(3))
    method = bool(ps) and ps[0] in ('&self', '&mut self', 'self')
    mine_sigs.setdefault(m.group(2), []).append((method, len(ps) - (1 if method else 0)))
sites = 0
for d in ['checker', 'evaluator', 'modulespecifiers']:
    for f in sorted(os.listdir(os.path.join(crate, d))):
        path = os.path.join(crate, d, f)
        if not f.endswith('.rs') or path == MINE:
            continue
        text = strip(open(path).read())
        own = set(re.findall(r'fn ([a-z0-9_]+)', text))
        for name, defs in mine_sigs.items():
            if name in ('contains', 'add', 'get'):
                continue
            for m in re.finditer(r'(?<![A-Za-z0-9_])((?:self|c|checker)\.)?' + re.escape(name) + r'\(', text):
                if text[max(0, m.start() - 3):m.start()] == 'fn ':
                    continue
                if not m.group(1) and text[max(0, m.start() - 1):m.start()] in ('.', ':'):
                    continue
                j, depth = m.end(), 1
                while j < len(text) and depth > 0:
                    depth += text[j] in '([{'
                    depth -= text[j] in ')]}'
                    j += 1
                n = len(split_args(text[m.end():j - 1]))
                sites += 1
                if not any(method == bool(m.group(1)) and count == n for method, count in defs):
                    # A method of the same name that the calling file or another file defines for the checker.
                    if bool(m.group(1)) and not any(method for method, _ in defs):
                        continue
                    if not m.group(1) and name in own:
                        continue
                    line = text.count('\n', 0, m.start()) + 1
                    report(f'5. {d}/{f}:{line}: {name} with {n} arguments, the file has {defs}')
print(f'5. {sites} call sites of the tree')

# 6
tree = {}
for d in ['ast', 'core', 'scanner', 'jsnum', 'module', 'printer', 'tspath', 'binder', 'stringutil', 'checker', 'diagnostics']:
    for root, _, fs in os.walk(os.path.join(crate, d)):
        for f in fs:
            path = os.path.join(root, f)
            if not f.endswith('.rs') or path == MINE:
                continue
            text = strip(open(path).read())
            for m in re.finditer(r'^(?:    )?pub(?:\(crate\))? (?:const )?fn ([a-z0-9_]+)(?:<[^>]*>)?\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)', text, re.M):
                ps = split_args(m.group(2))
                method = bool(ps) and re.match(r"(&('[a-z]+ )?(mut )?)?self$", ps[0]) is not None
                tree.setdefault(m.group(1), set()).add((method, len(ps) - (1 if method else 0)))
calls = 0
for m in re.finditer(r'(?<![A-Za-z0-9_])([a-z_][a-z0-9_]*)\(', body):
    name, start = m.group(1), m.start()
    if body[max(0, start - 3):start] == 'fn ' or name in words or name in closures:
        continue
    method = start > 0 and body[start - 1] == '.'
    if (name in local and not method) or name not in tree:
        continue
    j, depth = m.end(), 1
    while j < len(body) and depth > 0:
        depth += body[j] in '([{'
        depth -= body[j] in ')]}'
        j += 1
    args = body[m.end():j - 1]
    # A comparison or a match arm in an argument defeats the split: such a call is not counted.
    if re.search(r'[<>]=?|=>', args):
        continue
    n = len(split_args(args))
    same = [count for is_method, count in tree[name] if is_method == method]
    calls += 1
    if same and n not in same and name not in ('map', 'set', 'get', 'min', 'max', 'len', 'push', 'insert', 'contains'):
        line = src.count('\n', 0, head_end + start) + 1
        report(f'6. line {line}: {name} with {n} arguments, the tree has {sorted(set(same))}')
print(f'6. {calls} calls of the file')
sys.exit(1 if bad else 0)
