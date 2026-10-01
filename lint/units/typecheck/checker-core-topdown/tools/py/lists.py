import layers, collections
order = ['C-INIT','S-MERGE','N-RESOLVE','N-DIAG','D-SINK','A-ALIAS','M-MODULE','Q-ENTITY','T-KEYS','T-RSTACK','K-OBJ','MAPPER']
by = collections.defaultdict(list)
for f in layers.fns:
    if f['layer'] in order:
        by[f['layer']].append(f)
for l in order:
    fs = sorted(by[l], key=lambda f:(f['file'], f['start']))
    total = sum(f['end']-f['start']+1 for f in fs)
    print('## %s: %d functions, %d lines' % (l, len(fs), total))
    cur = None; out = []
    for f in fs:
        if f['file'] != cur:
            if out: print('  ' + cur + ': ' + ', '.join(out))
            cur = f['file']; out = []
        nm = f['name']
        if f['recv'] and 'Checker' not in f['recv']:
            nm = f['recv'].lstrip('*') + '.' + nm
        out.append('%s %d-%d' % (nm, f['start'], f['end']))
    if out: print('  ' + cur + ': ' + ', '.join(out))
