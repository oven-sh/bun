import sys,re
errs=[l for l in open(sys.argv[1]).read().split('\n') if l.strip()]
before=int(sys.argv[2]) if len(sys.argv)>2 else 2
after=int(sys.argv[3]) if len(sys.argv)>3 else 2
flt=sys.argv[4] if len(sys.argv)>4 else ''
for e in errs:
    m=re.match(r'([^:]+):(\d+):(\d+): (.*)', e)
    if not m: continue
    f,ln,col,msg=m.group(1),int(m.group(2)),int(m.group(3)),m.group(4)
    if flt and flt not in f: continue
    lines=open(f).read().split('\n')
    print(f'## {f}:{ln}:{col} {msg[:160]}')
    for k in range(max(0,ln-1-before), min(len(lines), ln+after)):
        print(('>> ' if k==ln-1 else '   ')+lines[k][:200])
