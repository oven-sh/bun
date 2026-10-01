import json,sys,collections
d=json.load(open(sys.argv[1]))
pkg=sys.argv[2]
c=collections.Counter(); cd=collections.Counter(); lines=collections.Counter()
for e in d:
    if e['pkg']!=pkg: continue
    k=(e['file'],e['kind'])
    c[k]+=1
    if e['direct']: cd[k]+=1
    if e['kind'] in('func','method'): lines[e['file']]+=e['end']-e['line']+1
for k in sorted(c):
    print('%-40s %-8s all=%4d direct=%4d'%(k[0],k[1],c[k],cd[k]))
print()
for f in sorted(lines): print('%-40s func+method body lines in closure: %d'%(f,lines[f]))
