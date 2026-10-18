import json, re, os, collections, subprocess
ROOT='/workspace/bun'
files = subprocess.check_output(['git','-C',ROOT,'ls-files','src/**/*.rs','src/*.rs'], text=True).split('\n')
files = [f for f in files if f.endswith('.rs')]
types = []
derive_re = re.compile(r'#\[derive\(([^)]*)\)\]')
item_re = re.compile(r'^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|union)\s+(\w+)')
impl_re = re.compile(r'^\s*(?:unsafe\s+)?impl\s*(<.*>)?\s*(?:::)?(?:core::default::|std::default::)?Default\s+for\s+(.+?)\s*(?:where\b.*)?\{?\s*$')
crate_of = {}
def crate_dir(f):
    d = os.path.dirname(f)
    while d and d != 'src':
        if os.path.exists(os.path.join(ROOT, d, 'Cargo.toml')): return d
        d = os.path.dirname(d)
    return d
for f in files:
    try: lines = open(os.path.join(ROOT,f), encoding='utf-8', errors='replace').read().split('\n')
    except Exception: continue
    cd = crate_dir(f)
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith('//'): continue
        m = derive_re.search(line)
        if m and re.search(r'\bDefault\b', m.group(1)):
            # find the item
            for j in range(i+1, min(i+40, len(lines))):
                mm = item_re.match(lines[j])
                if mm:
                    types.append({'crate_dir': cd, 'file': f, 'line': j+1, 'name': mm.group(2), 'kind': 'derive-'+mm.group(1)})
                    break
            else:
                types.append({'crate_dir': cd, 'file': f, 'line': i+1, 'name': '?', 'kind': 'derive-unknown'})
        mi = impl_re.match(line)
        if mi:
            target = mi.group(2).strip()
            base = re.sub(r'<.*$', '', target).split('::')[-1].strip()
            types.append({'crate_dir': cd, 'file': f, 'line': i+1, 'name': base or target, 'kind': 'impl', 'target': target})
json.dump(types, open('/tmp/audit/default_types.json','w'), indent=0)
c = collections.Counter(t['kind'] for t in types)
print(c, len(types))
pc = collections.Counter(t['crate_dir'] for t in types)
print(len(pc), pc.most_common(30))
