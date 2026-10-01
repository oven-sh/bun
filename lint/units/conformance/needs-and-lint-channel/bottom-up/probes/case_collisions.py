# Run instances whose files collide on a disk without case. usage: case_collisions.py <split.tsv of ../../top-down/probes/run.sh>
import csv, collections, sys
split = list(csv.DictReader(open(sys.argv[1]), delimiter='\t', quoting=csv.QUOTE_NONE))
whole, part = [], []
for r in split:
    files = [f for f in ([r['config']] + r['roots'].split('|') + r['others'].split('|')) if f]
    low = collections.defaultdict(set)
    for f in files: low[f.lower()].add(f)
    if any(len(v) > 1 for v in low.values()): whole.append(r['suite'] + '/' + r['name'])
    pl = collections.defaultdict(set)
    for f in files:
        parts = f.split('/')
        for i in range(2, len(parts) + 1):
            p = '/'.join(parts[:i]); pl[p.lower()].add(p)
    if any(len(v) > 1 for v in pl.values()): part.append(r['suite'] + '/' + r['name'])
print({'rows': len(split), 'wholeNamesDifferOnlyByCase': len(whole), 'aLeadingPartDiffersOnlyByCase': part})
