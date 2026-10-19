import re, subprocess, sys
files = subprocess.run(['git','ls-files','src','*.rs'],capture_output=True,text=True).stdout.split('\n')
files = [f for f in files if f.endswith('.rs')]
pat = re.compile(r'(Default::default|::default\(\)|derive\(.*Default|impl Default|Default impl|#\[default\]|`Default`|\bDefault\b trait|derives? `?Default|\.default\(\)|unwrap_or_default|or_default\b|\bdefault\(\)|derivable)')
n=0
out=[]
for f in files:
    try:
        txt=open(f,encoding='utf8',errors='replace').read().split('\n')
    except Exception: continue
    for i,l in enumerate(txt):
        c=l.find('//')
        if c<0: continue
        com=l[c:]
        if pat.search(com):
            out.append(f'{f}:{i+1}: {l.strip()[:200]}')
print(len(out))
open('/tmp/h/stale_comments.txt','w').write('\n'.join(out))
