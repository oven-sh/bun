import re,sys,collections
# usage: lineir.py <cg> <file regex> <line a> <line b>   sum of Ir/Bc on lines a..b of files matching, all functions
cg,rx,a,b=sys.argv[1],re.compile(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4])
cur=None; fl=None; ir=bc=0
for line in open(cg,errors='replace'):
    c=line[0]
    if c=='f':
        if line.startswith('fl='): fl=line[3:].rstrip('\n'); cur=fl
        elif line.startswith(('fi=','fe=')): cur=line[3:].rstrip('\n')
        elif line.startswith('fn='): cur=fl
        continue
    if not c.isdigit() or not rx.search(cur): continue
    p=line.split(); ln=int(p[0])
    if a<=ln<=b: ir+=int(p[1]); bc+=int(p[2]) if len(p)>2 else 0
print(ir,bc)
