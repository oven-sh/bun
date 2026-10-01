import json, sys
fns = json.load(open('/tmp/k3a/fns.json'))
def short(n):
    return n.replace('checker.Checker.', 'c.').replace('checker.', '')
mode = sys.argv[1]
if mode == 'symw':
    for f in sorted(fns, key=lambda f: (f['file'], f['start'])):
        if f['pkg'] != 'checker': continue
        for w in f.get('symw') or []:
            print(f"{f['file']}:{w['line']}\t{short(f['name'])}\t{w['kind']}\t{w['field']}\t{w['base']}\t{w['text'][:110]}")
elif mode == 'program':
    for f in sorted(fns, key=lambda f: (f['file'], f['start'])):
        for w in f.get('program') or []:
            print(f"{f['file']}:{w['line']}\t{short(f['name'])}\t{w['text']}")
elif mode == 'tracer':
    for f in sorted(fns, key=lambda f: (f['file'], f['start'])):
        for w in f.get('tracer') or []:
            print(f"{f['file']}:{w['line']}\t{short(f['name'])}\t{w['text']}")
elif mode == 'panics':
    lo, hi, file = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    for f in sorted(fns, key=lambda f: (f['file'], f['start'])):
        if f['file'] != file or f['start'] < lo or f['start'] > hi: continue
        for w in (f.get('panics') or []):
            print(f"{f['file']}:{w['line']}\t{short(f['name'])}\tPANIC\t{w['text']}")
        for w in (f.get('asserts') or []):
            print(f"{f['file']}:{w['line']}\t{short(f['name'])}\tASSERT\t{w['text']}")
