# Research probe: the resolved inputs of every run instance, trimmed to what a program stand-in reads, one JSON line per instance.
# usage: python3 programs.py <out.jsonl>     prints the sizes
import gzip, json, sys
from common import rows, key, fmt_by_ext
out = []
for r in rows():
    rec = {'n': key(r), 'files': []}
    for f in r['files'] or []:
        g = {'n': f['n']}
        if f['fmt'] != fmt_by_ext(f['n']): g['fmt'] = f['fmt']
        for k in ('pjt', 'pjd', 'jsx', 'helpers', 'ext', 'emi', 'cjs'):
            if f.get(k): g[k] = f[k]
        if f.get('res'): g['res'] = f['res']
        rec['files'].append(g)
    if [f['n'] for f in r['files'] or []] != (r['roots'] or []): rec['roots'] = r['roots']
    if r.get('autotypes'): rec['autotypes'] = r['autotypes']
    if r.get('libfiles'): rec['libfiles'] = [f['n'] for f in r['libfiles']]
    if not r['caseSensitive']: rec['caseInsensitive'] = True
    rec['libs'] = len(r['libs'].split(',')) if r['libs'] else 0
    out.append(json.dumps(rec, separators=(',', ':')))
out.sort()
text = ('\n'.join(out) + '\n').encode()
open(sys.argv[1], 'wb').write(text)
print('instances', len(out), 'bytes', len(text), 'gzip -9', len(gzip.compress(text, 9)))
