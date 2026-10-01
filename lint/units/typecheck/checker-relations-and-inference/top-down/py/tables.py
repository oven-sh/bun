# Work tables of the seven layers: functions, callees by owning layer, callers outside, calls between the layers.
from unified import *
fns = load()
byname = {}
for f in fns: byname.setdefault(f['name'], f)
mine = sorted([f for f in fns if f['layer'] in MINE], key=lambda f: (f['file'] != R, f['decl']))
mode = sys.argv[1]
def status(t):
    if t['layer'] in MINE: return 'this unit'
    if t['layer'] in EARLIER: return 'earlier'
    return 'later'
if mode == 'in':
    # callees outside the layer, grouped by the layer or module that owns them
    print('layer\tstatus\towner\tcallee\twhere\tcallers in the layer')
    for L in MINE:
        out = collections.OrderedDict()
        for f in mine:
            if f['layer'] != L: continue
            for cal in f['callees']:
                if not (cal.startswith('checker.') or cal.startswith('binder.')): continue
                t = byname.get(cal)
                if t is None or t['layer'] == L: continue
                out.setdefault(cal, []).append(short(f['name']))
        def key(n):
            t = byname[n]
            return ({'earlier': 0, 'this unit': 1, 'later': 2}[status(t)], t['layer'] or t['module'], t['file'], t['decl'])
        for cal in sorted(out, key=key):
            t = byname[cal]
            print(f"{L}\t{status(t)}\t{t['layer'] or t['module']}\t{short(cal)}\t{loc(t)}\t{', '.join(sorted(set(out[cal])))}")
if mode == 'out':
    print('layer\tfunction\twhere\tcaller status\tcaller owner\tcallers')
    callers = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in fns:
        if f['layer'] in MINE: continue
        for cal in f['callees']:
            t = byname.get(cal)
            if t is not None and t['layer'] in MINE:
                callers[cal][(status(f), f['layer'] or f['module'])].append(short(f['name']))
    for L in MINE:
        for f in mine:
            if f['layer'] != L or f['name'] not in callers: continue
            for m in sorted(callers[f['name']]):
                print(f"{L}\t{short(f['name'])}\t{loc(f)}\t{m[0]}\t{m[1]}\t{', '.join(sorted(set(callers[f['name']][m])))}")
if mode == 'insum':
    # one line per layer and owner: the callee names
    for L in MINE:
        groups = collections.OrderedDict()
        for f in mine:
            if f['layer'] != L: continue
            for cal in f['callees']:
                if not (cal.startswith('checker.') or cal.startswith('binder.')): continue
                t = byname.get(cal)
                if t is None or t['layer'] == L: continue
                groups.setdefault((status(t), t['layer'] or t['module']), set()).add(short(cal))
        print('== ' + L)
        for k in sorted(groups, key=lambda k: ({'earlier': 0, 'this unit': 1, 'later': 2}[k[0]], k[1])):
            print(f"  {k[0]} {k[1]} ({len(groups[k])}): {' '.join(sorted(groups[k]))}")
if mode == 'outsum':
    callers = collections.defaultdict(lambda: collections.defaultdict(set))
    for f in fns:
        if f['layer'] in MINE: continue
        for cal in f['callees']:
            t = byname.get(cal)
            if t is not None and t['layer'] in MINE:
                callers[t['layer']][(status(f), f['layer'] or f['module'])].add(short(cal))
    for L in MINE:
        print('== ' + L)
        for k in sorted(callers[L], key=lambda k: ({'earlier': 0, 'later': 2}[k[0]], k[1])):
            print(f"  {k[0]} {k[1]} ({len(callers[L][k])}): {' '.join(sorted(callers[L][k]))}")
if mode == 'funcs':
    codes = json.load(open('/tmp/k3a/codes.json'))['codes']
    print('layer\tfile\tlines\tfunction\tclosures\tcodes\tpanic lines\tin largest recursive component')
    import scc_members
    big = scc_members.members(fns)
    for f in mine:
        d = sorted(set(str(codes[n][0]) if n in codes else n for n in f['diags']), key=lambda x: (len(x), x))
        print(f"{f['layer']}\t{f['file'].split('/')[-1]}\t{f['start']}-{f['end']}\t{short(f['name'])}\t{f['closures']}\t{','.join(d)}\t{','.join(str(p['line']) for p in f['panics'])}\t{'yes' if f['name'] in big else ''}")
if mode == 'later':
    # callees that no layer of an earlier research pass owns: size of what has to come with them
    def closure(name):
        seen = collections.OrderedDict(); stack = [name]
        while stack:
            n = stack.pop()
            if n in seen: continue
            t = byname[n]; seen[n] = t
            for x in t['callees']:
                u = byname.get(x)
                if u is None or u['pkg'] != 'checker': continue
                if u['layer'] is None and u['module'] != 'tracer.go': stack.append(x)
        return seen
    later = collections.OrderedDict()
    for f in mine:
        for cal in f['callees']:
            t = byname.get(cal)
            if t is None or t['pkg'] != 'checker': continue
            if t['layer'] is None and t['module'] != 'tracer.go':
                later.setdefault(cal, {}).setdefault(f['layer'], set()).add(short(f['name']))
    print('callee\twhere\tmodule\tlines\tused by\tclosure functions\tclosure lines\tclosure')
    for cal in sorted(later, key=lambda n: (byname[n]['file'], byname[n]['decl'])):
        t = byname[cal]; cl = closure(cal)
        used = '; '.join(f"{L}: {', '.join(sorted(v))}" for L, v in later[cal].items())
        lines = sum(u['end'] - u['decl'] + 1 for u in cl.values())
        names = ' '.join(short(k) for k in sorted(cl, key=lambda k: (cl[k]['file'], cl[k]['decl']))) if len(cl) <= 16 else '(reaches the expression checker)'
        print(f"{short(cal)}\t{loc(t)}\t{t['module']}\t{t['end']-t['decl']+1}\t{used}\t{len(cl)}\t{lines}\t{names}")
