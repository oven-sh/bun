import sys, collections
sys.argv = ['x', 'none']
exec(open('/tmp/k3a/py/layers.py').read())
import importlib.util
# split table
SPLIT = []
src = open('/tmp/k3a/py/split.py').read()
import re
for m in re.finditer(r"\((\d+), '(\w+)', '([^']*)'\)", src):
    SPLIT.append((int(m.group(1)), m.group(2)))
def split_of(line):
    name = None; idx = 0
    for i,(s,n) in enumerate(SPLIT):
        if s <= line: name = n; idx = i+1
    return f"c{idx:02d}_{name}"
want = {'C-INIT','D-SINK','S-MERGE','N-RESOLVE','N-DIAG','A-ALIAS','M-MODULE','Q-ENTITY','T-KEYS','K-OBJ','T-RSTACK','MAPPER','LINKS','UTIL','TYPES'}
out = collections.OrderedDict()
for f in sorted(fns, key=lambda f:(f['file'], f['decl'])):
    if f['layer'] not in want: continue
    for cal in f['callees']:
        if not cal.startswith('checker.'): continue
        tg = byname.get(cal)
        if not tg: continue
        t = tg[0]
        if t['layer'] is None:
            out.setdefault(cal, set()).add(f['layer'])
rows = []
for cal, layers in out.items():
    t = byname[cal][0]
    fn = t['file'].split('/')[-1]
    where = split_of(t['decl']) if fn == 'checker.go' else fn[:-3]
    rows.append((fn != 'checker.go', fn, t['decl'], short(cal), where, sorted(layers)))
rows.sort()
cur = None
for _, fn, line, name, where, layers in rows:
    print(f"{fn}:{line}\t{name}\t{where}\t{','.join(layers)}")
print(len(rows))
