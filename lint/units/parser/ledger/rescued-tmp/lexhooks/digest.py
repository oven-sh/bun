import sys, re, json
rows = []
cur = None
for f in sys.argv[1:]:
    for line in open(f, encoding='utf-8', errors='replace'):
        line = line.rstrip('\n')
        if line.startswith('--- '):
            m = re.match(r'--- (.*?) \[(\w+)\] (.*)$', line)
            cur = {'name': m.group(1), 'loader': m.group(2), 'code': m.group(3), 'bun': [], 'tsc': [], 'syn': [], 'chk': []}
            rows.append(cur)
        elif cur is not None:
            m = re.match(r'\s+(bun|tsc|syn|chk): (.*)$', line)
            if m: cur[m.group(1)].append(m.group(2))
def short(s, n=64):
    return s if len(s) <= n else s[:n-1] + '…'
for r in rows:
    bun = short(r['bun'][0], 60) if r['bun'] else '(accepted)'
    tsc = short(r['tsc'][0], 46) if r['tsc'] else ''
    oth = ''
    if not r['tsc']:
        if r['syn']: oth = 'syn ' + short(r['syn'][0], 40)
        elif r['chk']: oth = 'chk ' + short(r['chk'][0], 40)
    print(f"{r['name']} | {r['code']} | {bun} | {tsc}{oth}")
