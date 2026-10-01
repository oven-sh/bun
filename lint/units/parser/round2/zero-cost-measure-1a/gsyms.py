import sys,re,collections,subprocess
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from buckets import TYPE
def run(binary):
    out=subprocess.run(['llvm-nm','-S','--defined-only','-C',binary],capture_output=True,text=True,errors='replace').stdout
    by={}
    for line in out.splitlines():
        m=re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if not m or m.group(3) not in 'tTwW': continue
        n=re.sub(r' \(\.llvm\.\d+\)$','',m.group(4))
        if 'bun_js_parser' not in n: continue
        by.setdefault(int(m.group(1),16),[]).append((int(m.group(2),16),n))
    agg=collections.defaultdict(lambda:[0,0]); rows=[]
    for a,v in by.items():
        names=[n for _,n in v]; size=max(s for s,_ in v)
        tn=[n for n in names if 'P<true, false>' in n and (TYPE.search(n) or 'lexer_backtracker' in n or 'named_like_cast' in n)]
        if not tn: continue
        n=tn[0]
        sink='Build' if 'type_sink::Build' in n else 'DecoratorMetadata' if 'DecoratorMetadata' in n else 'Discard' if 'Discard' in n else 'build_*/lint_* (Build only)' if re.search(r'>::(build_|lint_)',n) else 'no sink in the name'
        agg[sink][0]+=1; agg[sink][1]+=size; rows.append((size,sink,n))
    return agg,rows
for tag in sys.argv[1:]:
    agg,rows=run(tag)
    print('==',tag)
    for k in sorted(agg): print(f'   {k:32} {agg[k][0]:4} symbols {agg[k][1]:>9,} bytes')
    print(f'   {"all":32} {sum(v[0] for v in agg.values()):4} symbols {sum(v[1] for v in agg.values()):>9,} bytes')
    if '--rows' in sys.argv: 
        for r in sorted(rows,reverse=True)[:25]: print('      ',r[0],r[1],r[2][:120])
