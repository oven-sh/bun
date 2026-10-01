#!/usr/bin/env python3
"""Per source line / per source function sums of a cachegrind file.
usage: cgline.py <file.cg> <source root> [--files REGEX] [--by fn|line|sym|symfn] [--top N] [--grep REGEX] [--json out] [--sort Ir|Bc|Bi]
The source function of a line is the nearest preceding `fn name` line of the file at <source root>/<fl>."""
import re, sys, collections, json, os, bisect
def arg(k, d=None): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
def load(path):
    events = []; fn = None; fl = None
    per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fl='): fl = line[3:].rstrip('\n'); continue
                if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)$', '', line[3:].rstrip('\n')); continue
                if line.startswith(('fi=', 'fe=')): fl = line[3:].rstrip('\n'); continue
            if not c.isdigit():
                if line.startswith('events:'): events = line.split()[1:]
                continue
            parts = line.split()
            vals = [int(x) for x in parts[1:6]]; vals += [0] * (5 - len(vals))
            p = per[(fl, fn, int(parts[0]))]
            for i in range(5): p[i] += vals[i]
    return per
class Src:
    def __init__(self, root): self.root = root; self.c = {}
    def get(self, fl):
        if fl not in self.c:
            p = os.path.join(self.root, fl)
            try: L = open(p, errors='replace').read().split('\n')
            except OSError: L = None
            starts = []; names = []
            if L:
                for i, l in enumerate(L):
                    m = re.match(r'\s*(pub(\([^)]*\))? )?(const )?(unsafe )?(extern "C" )?fn (\w+)', l)
                    if m: starts.append(i + 1); names.append(m.group(6))
            self.c[fl] = (L, starts, names)
        return self.c[fl]
    def fn(self, fl, line):
        L, starts, names = self.get(fl)
        if not L: return '?'
        k = bisect.bisect_right(starts, line) - 1
        return names[k] if k >= 0 else '?'
    def text(self, fl, line):
        L, _, _ = self.get(fl)
        if not L or line < 1 or line > len(L): return ''
        return L[line - 1].strip()
if __name__ == '__main__':
    path, root = sys.argv[1], sys.argv[2]
    frx = re.compile(arg('--files', r'^src/(js_parser|ast)/'))
    S = Src(root)
    per = load(path)
    by = arg('--by', 'fn'); top = int(arg('--top', 60)); g = arg('--grep'); grx = re.compile(g) if g else None
    sk = {'Ir': 0, 'Bc': 1, 'Bi': 3}[arg('--sort', 'Bc')]
    agg = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    for (fl, fn, line), v in per.items():
        if not fl or not frx.search(fl): continue
        if by == 'fn': key = (fl.split('/')[-1], S.fn(fl, line))
        elif by == 'line': key = (fl.split('/')[-1], line, S.fn(fl, line), S.text(fl, line)[:110])
        elif by == 'symfn': key = (fn, fl.split('/')[-1], S.fn(fl, line))
        elif by == 'symline': key = (fn, fl.split('/')[-1], line, S.text(fl, line)[:100])
        else: key = (fn,)
        if grx and not grx.search(' '.join(str(x) for x in key) + ' ' + (S.text(fl, line) if by != 'sym' else '')): continue
        a = agg[key]
        for i in range(5): a[i] += v[i]
    tot = [sum(v[i] for v in agg.values()) for i in range(5)]
    print(f'selected  Ir {tot[0]:,}  Bc {tot[1]:,}  Bi {tot[3]:,}  ({len(agg)} keys)')
    if arg('--json'):
        json.dump({'|'.join(str(x) for x in k): v for k, v in agg.items()}, open(arg('--json'), 'w'))
    for k, v in sorted(agg.items(), key=lambda kv: -kv[1][sk])[:top]:
        print(f'  Ir {v[0]:>12,}  Bc {v[1]:>11,}  Bi {v[3]:>9,}  ' + '  '.join(str(x) for x in k))
