import json,sys,collections
d=json.load(open(sys.argv[1]))
pkg=sys.argv[2]
kinds=set(sys.argv[3].split(',')) if len(sys.argv)>3 and sys.argv[3] else None
filef=sys.argv[4] if len(sys.argv)>4 else None
cur=None
for e in d:
    if e['pkg']!=pkg: continue
    if kinds and e['kind'] not in kinds: continue
    if filef and not e['file'].endswith(filef): continue
    if e['file']!=cur:
        cur=e['file']; print('##',cur)
    tag='D%d'%e['direct'] if e['direct'] else 'T(depth %d via %s)'%(e['depth'],e.get('via',''))
    by=','.join(e.get('directBy',[]))
    extra=''
    if e.get('panics'): extra+=' PANICS=%d'%e['panics']
    if e.get('std'): extra+=' std=['+','.join(e['std'])+']'
    print('  %-7s %-50s %d-%d  %s %s%s'%(e['kind'],e['name'],e['line'],e['end'],tag,by,extra))
