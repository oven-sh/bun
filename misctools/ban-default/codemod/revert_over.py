import sys, json, re, subprocess, collections
sys.path.insert(0, '/tmp/codemod')
import load
ROOT = '/workspace/bun/'
F0 = 'f09deb7b3f'
crates, impls, calls, obligs = load.load(['/tmp/oracle-f0/linux', '/tmp/oracle-f0/win', '/tmp/oracle-f0/mac'])
WRAP = set(json.load(open('/tmp/codemod/overrides.json')).keys())
def keys(tree, out=None, precise=True):
    out = out if out is not None else []
    k = tree['k']
    if k == 'local':
        out.append((tree['krate'], tree['path']))
        if not precise or (tree['krate'] + tree['path']) in WRAP:
            for t in tree.get('targs', []): keys(t, out, precise)
    elif k == 'wrap': keys(tree['inner'], out, precise)
    elif k == 'tuple':
        for t in tree['items']: keys(t, out, precise)
    elif k == 'array': keys(tree['elem'], out, precise)
    elif k == 'extern':
        targs = tree.get('targs', []); name = tree['name']
        if not precise:
            for t in targs: keys(t, out, precise)
        elif name == 'HashMap' and len(targs) > 2: keys(targs[2], out, precise)
        elif name == 'HashSet' and len(targs) > 1: keys(targs[1], out, precise)
        elif name == 'EnumMap' and len(targs) > 1: keys(targs[1], out, precise)
        elif name == 'Range' and targs: keys(targs[0], out, precise)
    return out
_old = {}
def old(path):
    if path not in _old:
        _old[path] = subprocess.check_output(['git', '-C', ROOT, 'show', f'{F0}:{path}'])
    return _old[path]
def ws_re(text):
    toks = re.findall(r'\w+|[^\w\s]', text)
    return r'\s*'.join(re.escape(t) for t in toks)
def match_paren(s, i):
    depth = 0; j = i
    while True:
        if s[j] in '([{': depth += 1
        elif s[j] in ')]}':
            depth -= 1
            if depth == 0: return j
        j += 1
done = 0; failed = []
by_file = collections.defaultdict(list)
for o in obligs:
    if o['callee_workspace'] or o['span'].get('exp'): continue
    if not keys(o['init'], precise=False) or keys(o['init'], precise=True): continue
    by_file[o['span']['file']].append(o)
for path, recs in by_file.items():
    cur = open(ROOT + path).read()
    ob = old(path)
    for o in sorted(recs, key=lambda r: -r['span']['lo']):
        sp = o['span']; name = o['callee_name']
        orig = ob[sp['lo']:sp['hi']].decode()
        if name == 'take' and o['form'] == 'call':
            csp = o['call']['callee_span']
            callee = ob[csp['lo']:csp['hi']].decode()
            args = orig[len(callee):].strip()  # "(...)"
            inner = args[1:-1].strip().rstrip(',')
            new_callee = 'core::mem::replace' if callee == 'take' else callee[:-4] + 'replace'
            pat = re.compile(ws_re(new_callee + '(' + inner) + r'\s*,')
            ms = list(pat.finditer(cur))
        elif o['form'] == 'method' and name in ('unwrap_or_default', 'or_default', 'get_or_insert_default'):
            msp = o['method']['method_span']
            recv = ob[sp['lo']:msp['lo']].decode()   # "... ."
            newname = {'unwrap_or_default': r'(?:unwrap_or_else|unwrap_or)', 'or_default': r'(?:or_insert_with|or_insert)', 'get_or_insert_default': 'get_or_insert_with'}[name]
            pat = re.compile(ws_re(recv) + r'\s*' + newname + r'\s*\(')
            ms = list(pat.finditer(cur))
        else:
            continue
        if len(ms) != 1:
            # pick the match nearest to the original line
            if not ms:
                failed.append((path, sp['line'], name, 'no match')); continue
            line_of = lambda m: cur[:m.start()].count('\n') + 1
            ms.sort(key=lambda m: abs(line_of(m) - sp['line']))
        m = ms[0]
        # the opening paren of the call to remove
        if name == 'take':
            open_i = cur.index('(', m.start() + len(new_callee.split('::')[0]))
            # find the '(' right after the callee text
            cm = re.compile(ws_re(new_callee) + r'\s*\(').match(cur, m.start())
            open_i = cm.end() - 1
            close_i = match_paren(cur, open_i)
            cur = cur[:m.start()] + orig + cur[close_i + 1:]
        else:
            open_i = m.end() - 1
            close_i = match_paren(cur, open_i)
            cur = cur[:m.start()] + orig + cur[close_i + 1:]
        done += 1
    open(ROOT + path, 'w').write(cur)
print('reverted', done, 'failed', len(failed))
for f in failed: print('  ', f)
