#!/usr/bin/env python3
"""Runs the tsc oracle over the sources of annotation_tests.rs and compares its lines with the expected lines there."""
import json, re, subprocess
rs = open('/workspace/wt/parser/src/js_parser/parse/annotation_tests.rs').read()
def unescape(s):
    return bytes(s, 'utf8').decode('unicode_escape')
cases = []
for m in re.finditer(r'Case \{\s*name: "([^"]+)",\s*path: b"([^"]+)",\s*loader: Loader::(\w+),\s*text: b"((?:[^"\\]|\\.)*)",\s*records: &\[(.*?)\],\s*\}', rs, re.S):
    name, path, loader, text, records = m.groups()
    recs = re.findall(r'"((?:[^"\\]|\\.)*)"', records)
    cases.append({'name': name, 'file': path.lstrip('/'), 'text': unescape(text), 'records': recs, 'loader': loader})
print(len(cases), 'cases')
json.dump([{k: c[k] for k in ('name','file','text')} for c in cases if c['loader'] != 'Js'], open('/tmp/annotation-sites.from_rs.json','w'))
out = subprocess.run(['node','/workspace/notes/lint/units/parser/probes/annotation-sites/oracle.cjs','/tmp/annotation-sites.from_rs.json'], capture_output=True, text=True).stdout
got = {}
cur = None
for line in out.split('\n'):
    if line.startswith('== '):
        cur = line[3:].split('  ')[0]; got[cur] = []
    elif line.strip().startswith('"'):
        got[cur].append(line.strip().strip(',').strip('"'))
    elif line.strip().startswith('diag'):
        print('DIAG', cur, line)
ok = True
for c in cases:
    if c['loader'] == 'Js':
        print(c['name'], 'js: expected none ->', c['records'] == [])
        continue
    same = got.get(c['name']) == c['records']
    ok &= same
    print(c['name'], 'same' if same else 'DIFFERENT', len(c['records']))
    if not same:
        print('  oracle:', got.get(c['name'])); print('  rust  :', c['records'])
print('ALL SAME' if ok else 'MISMATCH')
