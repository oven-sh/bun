import json,sys
f=sys.argv[1]; kinds=set(sys.argv[2].split(',')) if len(sys.argv)>2 else None
d=json.load(open(f))
for c in d:
    if c['kind']!='same' and (kinds is None or c['kind'] in kinds):
        print(c['kind'], json.dumps(c['code']), '['+c['ext']+']')
        print('    eslint:', (' | '.join(c['eslint']) or '(none)') if c['eslint'] is not None else 'FATAL '+str(c.get('fatal')))
        print('    bun:   ', (' | '.join(c['bun']) or '(none)') if c['bun'] is not None else 'REJECTS '+str(c.get('rejected')))
