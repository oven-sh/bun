import re,sys
f=sys.argv[1]; before=int(sys.argv[2]); after=int(sys.argv[3])
pat=re.compile(sys.argv[4] if len(sys.argv)>4 else r'starts_for_parse_only|is_lint_parse|sidecar_mark|lint_logged')
L=open(f).read().split('\n')
hits=[i for i,l in enumerate(L) if pat.search(l)]
# merge windows
wins=[]
for i in hits:
    a=max(0,i-before); b=min(len(L)-1,i+after)
    if wins and a<=wins[-1][1]+1: wins[-1][1]=b
    else: wins.append([a,b])
# find enclosing fn
def enc(i):
    for j in range(i,-1,-1):
        m=re.match(r'\s*(pub(\(crate\))? )?(unsafe )?fn (\w+)',L[j])
        if m: return m.group(4),j+1
    return '?',0
for a,b in wins:
    name,ln=enc(a)
    print(f'---- {f.split("/")[-1]}:{a+1}-{b+1}  in fn {name} (line {ln})')
    for k in range(a,b+1):
        mark='>>' if pat.search(L[k]) else '  '
        print(f'{mark}{k+1:5} {L[k]}')
