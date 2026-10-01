import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
pk=set(sys.argv[3].split(','))
kinds=set(sys.argv[4].split(','))
ka={(e['pkg'],e['kind'],e['name'],e['file'],e['line']) for e in a}
cur=None
for e in b:
    k=(e['pkg'],e['kind'],e['name'],e['file'],e['line'])
    if e['pkg'] in pk and e['kind'] in kinds and k not in ka:
        if e['file']!=cur:
            cur=e['file']; print('##',cur)
        print('  + %-7s %-45s %d-%d %s'%(e['kind'],e['name'],e['line'],e['end'],('D%d '%e['direct']+','.join(e.get('directBy',[]))) if e['direct'] else 'T via '+e.get('via','')))
