#!/usr/bin/env python3
"""probe_types.py <bun> <work folder> <with_roles.ts> <untyped.json> <extra.json>
A variable that has roles but no written type of its own (`var x = f()`, a parameter typed by its context): what type does the checker give it? Asked of the text WITH roles:
`((null as any as typeof x) satisfies never);` before the function's closing brace: the error names the type. Adds "function/variable": [type] to extra.json where there is no entry yet."""
import json, re, subprocess, sys, os
bun, work, text_path, untyped_path, extra_path = sys.argv[1:6]
NS = os.environ.get('NS', 'RR')
text = open(text_path).read(); U = json.load(open(untyped_path)); extra = json.load(open(extra_path)) if os.path.exists(extra_path) else {}
names = set(re.findall(r'(?:interface|type|enum|class) (\w+)', text))
out = []; at = 0; where = []
for fn, base, close in sorted(U, key=lambda u: u[2]):
    out.append(text[at:close]); at = close
    piece = ';((null as any as typeof %s) satisfies never);\n' % base
    where.append((sum(len(o) for o in out), fn, base)); out.append(piece)
out.append(text[at:])
probe = ''.join(out)
d = work + '/probe-types'; os.makedirs(d, exist_ok=True)
config = json.load(open(work + '/tsconfig.json')); config['compilerOptions']['noErrorTruncation'] = True
name = config['files'][0]
open(d + '/' + name, 'w').write(probe)
json.dump(config, open(d + '/tsconfig.json', 'w'))
r = subprocess.run([bun, 'check', '--all', '--no-pretty'], cwd=d, capture_output=True, text=True)
L = [0] + [m.end() for m in re.finditer('\n', probe)]
found = 0
for m in re.finditer(r"^" + re.escape(name) + r"\((\d+),(\d+)\): error TS1360: Type '(.*)' does not satisfy the expected type 'never'\.$", r.stdout + r.stderr, flags=re.M):
    off = L[int(m.group(1)) - 1] + int(m.group(2)) - 1
    for start, fn, base in where:
        if start <= off < start + 80 + len(base):
            t = re.sub(r'(?<![\w.$"\'])([A-Za-z_]\w*)\b', lambda g: NS + '.' + g.group(1) if g.group(1) in names else g.group(1), m.group(3))
            key = '%s/%s' % (fn, base)
            if key not in extra: extra[key] = [t]; found += 1
            elif extra[key][0] != t and t not in extra[key]: extra[key].insert(0, t); found += 1
json.dump(extra, open(extra_path, 'w'), indent=1)
subprocess.run(['rm', '-rf', d])
print('probe_types: %d variables without a written type, %d types found' % (len(U), found))
