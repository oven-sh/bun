import re, json, sys, collections
codes = {}
for line in open('/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go'):
    m = re.match(r'var (\w+) = &Message\{code: (\d+), category: Category(\w+),', line)
    if m:
        codes[m.group(1)] = (int(m.group(2)), m.group(3))
import layers
by = collections.defaultdict(lambda: collections.defaultdict(set))
for f in layers.fns:
    if not f['layer']: continue
    for s in f.get('diags') or []:
        c = codes.get(s['text'])
        by[f['layer']][c[0] if c else s['text']].add(f['name'])
for l in by:
    print('== %s: %d codes' % (l, len(by[l])))
    print(', '.join(str(k) for k in sorted(by[l], key=lambda x: (isinstance(x,str), x))))
if len(sys.argv) > 1 and sys.argv[1] == 'detail':
    for l in by:
        print('== ' + l)
        for k in sorted(by[l], key=lambda x: (isinstance(x,str), x)):
            print('  %s\t%s' % (k, ', '.join(sorted(by[l][k]))))
