import sys,re
# usage: extract.py file CLASS  -> prints families and the distinct entries of that class
f=sys.argv[1]; cls=sys.argv[2]
fam=None; incls=False
out=[]
for line in open(f,encoding='utf-8',errors='replace'):
    line=line.rstrip('\n')
    if line.startswith('==== family'):
        fam=line; incls=False; out.append(line); continue
    m=re.match(r'^  -- (\w+): (\d+) distinct',line)
    if m:
        incls = (m.group(1)==cls)
        if incls: out.append(line)
        continue
    if incls:
        out.append(line)
print('\n'.join(out))
