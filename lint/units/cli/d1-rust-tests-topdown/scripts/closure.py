import re, os, sys
root = '/workspace/wt/cli'
txt = open(os.path.join(root, 'Cargo.toml')).read()
ws = txt[txt.index('[workspace.dependencies]'):]
paths = dict(re.findall(r'^([A-Za-z0-9_\-]+)\s*=\s*\{[^}\n]*path\s*=\s*"([^"]+)"', ws, re.M))
def deps_of(d):
    p = os.path.join(root, d, 'Cargo.toml')
    t = open(p).read()
    out = {}
    sec = None
    for line in t.splitlines():
        m = re.match(r'^\[(.+)\]\s*$', line)
        if m:
            sec = m.group(1); continue
        if sec and (sec == 'dependencies' or sec.endswith('.dependencies') and 'dev-' not in sec and 'build-' not in sec):
            m = re.match(r'^([A-Za-z0-9_\-]+)\s*(\.workspace)?\s*=\s*(.*)$', line)
            if m:
                name = m.group(1)
                rest = m.group(3)
                pm = re.search(r'path\s*=\s*"([^"]+)"', rest)
                if pm:
                    out[name] = os.path.normpath(os.path.join(d, pm.group(1)))
                elif name in paths:
                    out[name] = paths[name]
                else:
                    out[name] = None
    return out
start = sys.argv[1]
seen = {}
ext = set()
stack = [(start, paths[start])]
while stack:
    n, d = stack.pop()
    if n in seen: continue
    seen[n] = d
    for k, v in deps_of(d).items():
        if v is None: ext.add(k)
        elif k not in seen: stack.append((k, v))
for n in sorted(seen):
    d = seen[n]
    b = os.path.exists(os.path.join(root, d, 'build.rs'))
    print(f"{n:28} {d:28} {'build.rs' if b else ''}")
print('external:', ' '.join(sorted(ext)))
print('count:', len(seen))
