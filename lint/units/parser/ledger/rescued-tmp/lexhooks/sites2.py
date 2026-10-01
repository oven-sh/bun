import re,sys
root='/workspace/ref/typescript-go/internal/'
gen=open(root+'diagnostics/diagnostics_generated.go').read()
msgs={}
for m in re.finditer(r'^var (\w+) = &Message\{code: (\d+), category: (\w+), key: "[^"]*", text: "((?:[^"\\]|\\.)*)"',gen,re.M):
    msgs[m.group(1)]=(int(m.group(2)),m.group(4))
f=sys.argv[1]
src=open(root+f).read().split('\n')
fn=None
for i,l in enumerate(src,1):
    m=re.match(r'^func (?:\(\w+ \*?\w+\) )?(\w+)',l)
    if m: fn=m.group(1)
    if 'parseErrorAt' in l and sys.argv[2]=='other': continue
    for n in re.findall(r'diagnostics\.(\w+)',l):
        if n in ('Message',): continue
        c=msgs.get(n,(0,'?'))
        print(f"{i}\t{fn}\tTS{c[0]}\t{c[1][:110]}\t|| {l.strip()[:120]}")
