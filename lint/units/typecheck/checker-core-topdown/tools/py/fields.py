import re, collections, layers
src = open('/workspace/ref/typescript-go/internal/checker/checker.go').read().split('\n')
fields = []
for i in range(585, 906):
    line = src[i]
    m = re.match(r'\t(\w+)\s+(.+?)(\s*//.*)?$', line)
    if m:
        fields.append((i+1, m.group(1), m.group(2).strip()))
use = collections.defaultdict(lambda: collections.defaultdict(set))
for f in layers.fns:
    for cf in f.get('cfields') or []:
        use[cf][f['layer'] or ('~'+f['file'].split('/')[-1])].add(f['name'])
order = ['C-INIT','S-MERGE','N-RESOLVE','N-DIAG','D-SINK','A-ALIAS','M-MODULE','Q-ENTITY','T-KEYS','T-RSTACK','K-OBJ','MAPPER','UTIL','TYPES','LINKS']
print(len(fields), 'fields')
for (ln, name, typ) in fields:
    u = use.get(name, {})
    ins = [l for l in order if l in u]
    # in C-INIT, only NewChecker?
    note = ''
    if 'C-INIT' in u:
        note = '[' + ','.join(sorted(u['C-INIT']))[:60] + ']'
    outs = sum(len(v) for k,v in u.items() if k.startswith('~'))
    print('%d\t%s\t%s\t%s\t%s\tout=%d' % (ln, name, typ, ','.join(ins), note, outs))
