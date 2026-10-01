import re, subprocess, sys
def load(path):
    fns = {}; cur = None; body = []
    for line in open(path, errors='replace'):
        m = re.match(r'\s*\.type\s+(\S+),@function', line)
        if m:
            cur = m.group(1); body = []; continue
        if cur is not None:
            if re.match(r'\s*\.size\s+' + re.escape(cur) + r'\b', line):
                fns[cur] = ''.join(body); cur = None
            else:
                body.append(line)
    return fns
def demangle(names):
    out = subprocess.run(['rustfilt'], input='\n'.join(names), capture_output=True, text=True)
    return out.stdout.split('\n') if out.returncode == 0 else names
a, b = load(sys.argv[1]), load(sys.argv[2])
# labels local to a function are numbered by the file: compare bodies with the numbers of local labels removed
norm = lambda text: re.sub(r'\.L[A-Za-z_]*\d+(_\d+)?', '.L', text)
only_a = sorted(set(a) - set(b)); only_b = sorted(set(b) - set(a))
changed = sorted(n for n in set(a) & set(b) if norm(a[n]) != norm(b[n]))
print('functions', len(a), len(b), 'only in first', len(only_a), 'only in second', len(only_b), 'changed', len(changed))
try:
    for label, names in (('only in first', only_a), ('only in second', only_b), ('changed', changed)):
        for n, d in zip(names, demangle(names)): print(' ', label + ':', d[:200], '| lines', (a.get(n) or b.get(n)).count('\n'))
except FileNotFoundError:
    for label, names in (('only in first', only_a), ('only in second', only_b), ('changed', changed)):
        for n in names: print(' ', label + ':', n[:200])
