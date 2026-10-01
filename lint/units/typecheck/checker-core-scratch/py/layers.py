import json, re, sys, collections
fns = json.load(open('/tmp/k3a/fns.json'))
codes = {}
for line in open('/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go'):
    m = re.match(r'var (\w+) = &Message\{code: (\d+), category: Category(\w+),', line)
    if m: codes[m.group(1)] = (int(m.group(2)), m.group(3))
LAYERS = [
 ('MAPPER',    'checker/mapper.go', 1, 326),
 ('UTIL',      'checker/utilities.go', 1, 1868),
 ('LINKS',     'checker/links.go', 1, 50),
 ('TYPES',     'checker/types.go', 1, 1474),
 ('T-KEYS',    'checker/checker.go', 17471, 17775),
 ('K-OBJ',     'checker/checker.go', 25126, 25394),
 ('T-RSTACK',  'checker/checker.go', 18861, 18958),
 ('C-INIT',    'checker/checker.go', 908, 1503),
 ('D-SINK',    'checker/checker.go', 14052, 14168),
 ('S-MERGE',   'checker/checker.go', 14170, 14531),
 ('N-RESOLVE', 'binder/nameresolver.go', 1, 498),
 ('N-RESOLVE', 'checker/checker.go', 2182, 2200),
 ('N-RESOLVE', 'checker/checker.go', 13991, 14050),
 ('N-DIAG',    'checker/checker.go', 1505, 2180),
 ('A-ALIAS',   'checker/checker.go', 14533, 15193),
 ('A-ALIAS',   'checker/checker.go', 15830, 15861),
 ('A-ALIAS',   'checker/checker.go', 16349, 16493),
 ('M-MODULE',  'checker/checker.go', 15195, 15828),
 ('M-MODULE',  'checker/checker.go', 16014, 16347),
 ('Q-ENTITY',  'checker/checker.go', 15863, 16012),
]
def layer_of(f):
    for name, file, lo, hi in LAYERS:
        if f['file'] == file and lo <= f['decl'] <= hi:
            return name
    return None
for f in fns:
    for k in ('callees','diags','panics','asserts','maprange','program','tracer','symw','links','fields'):
        if f.get(k) is None: f[k] = []
byname = {}
for f in fns:
    f['layer'] = layer_of(f)
    byname.setdefault(f['name'], []).append(f)
def short(n):
    return n.replace('checker.Checker.', 'c.').replace('checker.', '').replace('binder.NameResolver.', 'r.')
def loc(f):
    return f"{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}"
json.dump({'codes': codes}, open('/tmp/k3a/codes.json','w'))
if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'summary':
        agg = collections.OrderedDict()
        for f in fns:
            if f['layer']:
                a = agg.setdefault(f['layer'], [0,0])
                a[0] += 1; a[1] += f['end'] - f['decl'] + 1
        for k,v in agg.items(): print(k, v)
    if mode == 'standins':
        # callees in checker pkg (or binder) that are not in any layer
        want = sys.argv[2]
        out = collections.OrderedDict()
        for f in sorted(fns, key=lambda f:(f['file'], f['decl'])):
            if f['layer'] != want: continue
            for cal in f['callees']:
                if not (cal.startswith('checker.') or cal.startswith('binder.')): continue
                tg = byname.get(cal)
                if not tg: continue
                t = tg[0]
                if t['layer'] is None and t['file'] != 'binder/binder.go':
                    out.setdefault(cal, []).append(short(f['name']))
        for cal, users in out.items():
            t = byname[cal][0]
            print(f"{short(cal)}\t{loc(t)}\t<- {', '.join(sorted(set(users)))}")
    if mode == 'funcs':
        want = sys.argv[2]
        for f in sorted(fns, key=lambda f:(f['file'], f['decl'])):
            if f['layer'] != want: continue
            d = []
            for n in f['diags']:
                c = codes.get(n)
                d.append(str(c[0]) if c else n)
            extra = ''
            if d: extra += ' codes=' + ','.join(sorted(set(d), key=lambda x: int(x) if x.isdigit() else 0))
            if f['panics']: extra += ' PANIC@' + ','.join(str(p['line']) for p in f['panics'])
            if f['asserts']: extra += ' ASSERT@' + ','.join(str(p['line']) for p in f['asserts'])
            if f['maprange']: extra += ' MAPRANGE@' + ','.join(str(p['line']) for p in f['maprange'])
            if f['program']: extra += ' PROGRAM=' + ','.join(sorted(set(p['text'] for p in f['program'])))
            if f['closures']: extra += f" closures={f['closures']}"
            print(f"{f['decl']}-{f['end']} {short(f['name'])}{extra}")
    if mode == 'panics':
        for f in sorted(fns, key=lambda f:(f['file'], f['decl'])):
            if not f['layer']: continue
            for p in f['panics']:
                print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tpanic\t{p['text']}")
            for p in f['asserts']:
                print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tassert\t{p['text']}")
