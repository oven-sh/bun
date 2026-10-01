# Executed statement blocks of the functions of the twelve layers, from a Go cover profile (mode count) of the probe.
# usage: blocks.py <cover profile>     output: layer, function, calls of the first block, executed lines, then the executed line ranges with counts
import re, sys, collections
from zones import *
byfile = collections.defaultdict(list)
for f in fns:
    if f['mine']: byfile[f['file']].append(f)
hits = collections.defaultdict(list)
for l in open(sys.argv[1]):
    m = re.match(r'github.com/microsoft/typescript-go/internal/(\S+?):(\d+)\.\d+,(\d+)\.\d+ (\d+) (\d+)', l)
    if not m or int(m.group(5)) == 0: continue
    file, a, b, n = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(5))
    for f in byfile.get(file, ()):
        if f['decl'] <= a and b <= f['end']: hits[(f['pkg'], f['q'])].append((a, b, n)); break
print('layer\tfunction\twhere\tentries\texecuted blocks as first-last line x count')
for k in sorted(hits, key=lambda k: (ORDER.index(byname[k]['zone']), byname[k]['file'], byname[k]['decl'])):
    f = byname[k]
    hs = sorted(hits[k])
    print('%s\t%s\t%s\t%d\t%s' % (f['zone'], short(f), loc(f), hs[0][2], ' '.join('%d-%dx%d' % h for h in hs)))
