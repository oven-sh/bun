# This pass against the bottom-up pass: the same sources, the same result of main, the same validity for tsc, the same class.
# usage: python3 crosscheck.py <scratch dir>
import json, sys
S = sys.argv[1] if len(sys.argv) > 1 else '/tmp/r4'
B = '/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/'
sib = json.load(open(B + 'rows.classified.json'))
base = json.load(open(S + '/base.rows.json')); tsc = json.load(open(S + '/tsc.rows.json')); cls = json.load(open(S + '/rows.class.json'))
d = {'source': 0, 'main': 0, 'valid': 0, 'class': 0}
for s, b, t, c in zip(sib, base, tsc, cls):
    d['source'] += s['src'] != b['src'] or s['loader'] != b['loader']
    d['main'] += s['main'] != b['res']
    d['valid'] += s['valid'] != t['tsc']['valid']
    d['class'] += s['class'] != c['class']
print(len(sib), 'rows; differences:', d)
