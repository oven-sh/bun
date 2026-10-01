# Maps a Go count-mode cover profile to entry counts per function of the checker package.
# usage: cov.py <profile>     prints: file, lines, function, calls of the first block, blocks hit of blocks
import sys, os, re, bisect, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layers as L
prof = collections.defaultdict(list)
for ln in open(sys.argv[1]):
    m = re.match(r'.*/internal/([^:]+):(\d+)\.(\d+),(\d+)\.(\d+) (\d+) (\d+)', ln)
    if m: prof[m.group(1)].append((int(m.group(2)), int(m.group(3)), int(m.group(7))))
for f in sorted(L.fns, key=lambda f: (f['file'], f['decl'])):
    blocks = prof.get(f['file'])
    if not blocks: continue
    if not getattr(L, '_sorted', {}).get(f['file']):
        blocks.sort(); L.__dict__.setdefault('_sorted', {})[f['file']] = True
    i = bisect.bisect_left(blocks, (f['decl'], 0, 0))
    inside = []
    while i < len(blocks) and blocks[i][0] <= f['end']:
        inside.append(blocks[i]); i += 1
    if inside and inside[0][2] > 0:
        print('%s\t%d-%d\t%s\tcalls=%d\tblocks=%d/%d' % (f['file'], f['decl'], f['end'], L.short(f), inside[0][2], sum(1 for b in inside if b[2] > 0), len(inside)))
