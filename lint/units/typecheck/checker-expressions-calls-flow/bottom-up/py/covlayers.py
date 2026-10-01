# Which functions of the twelve layers each probe input enters. Reads <dir>/<input>.entered.tsv as cov.py writes them.
# usage: covlayers.py <dir> <input>...
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layers as L
bykey = {(f['file'], f['decl']): f for f in L.fns}
d = sys.argv[1]; inputs = sys.argv[2:]
entered = {}
for inp in inputs:
    s = {}
    for ln in open('%s/%s.entered.tsv' % (d, inp)):
        file, rng, name, calls, blocks = ln.rstrip('\n').split('\t')
        f = bykey.get((file, int(rng.split('-')[0])))
        if f is not None and f['mine']: s[(f['file'], f['decl'])] = int(calls.split('=')[1])
    entered[inp] = s
print('layer\tfunctions\t' + '\t'.join(inputs) + '\tentered by any\tnever entered')
union = set()
for lay in L.ORDER:
    fs = L.ours(lay); row = []; anyset = set()
    for inp in inputs:
        n = [f for f in fs if (f['file'], f['decl']) in entered[inp]]
        row.append(str(len(n))); anyset |= set((f['file'], f['decl']) for f in n)
    union |= anyset
    print('%s\t%d\t%s\t%d\t%d' % (lay, len(fs), '\t'.join(row), len(anyset), len(fs) - len(anyset)))
allmine = L.ours()
print('TOTAL\t%d\t%s\t%d\t%d' % (len(allmine), '\t'.join(str(len(entered[i])) for i in inputs), len(union), len(allmine) - len(union)))
print('== functions of the twelve layers that the first input enters, with call counts:')
print(' ' + ' '.join('%s=%d' % (L.short(bykey[k]).replace('c.', ''), v) for k, v in sorted(entered[inputs[0]].items())))
print('== functions of the twelve layers that no probe input enters:')
for lay in L.ORDER:
    miss = [L.short(f).replace('c.', '') for f in L.ours(lay) if (f['file'], f['decl']) not in union]
    print(' %s (%d): %s' % (lay, len(miss), ' '.join(miss)))
