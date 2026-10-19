import re, subprocess
files = [f for f in subprocess.run(['git','ls-files','src'],capture_output=True,text=True).stdout.split('\n') if f.endswith('.rs')]
# comments that mention Default (any form) or mem::take / Cell::take next to code that says replace
pat = re.compile(r'\bDefault\b')
out=[]
for f in files:
    txt=open(f,encoding='utf8',errors='replace').read().split('\n')
    for i,l in enumerate(txt):
        c=l.find('//')
        if c<0: continue
        com=l[c:]
        if pat.search(com):
            # skip: enum variant paths and plain prose 'Default' at sentence start
            if re.search(r'::Default\b|Default(Clause|Keyword|Export|Import|Alloc)|ExportDefault|ImportDefault', com) and not re.search(r'`Default`|Default::|: Default|impl Default|derive', com):
                continue
            out.append(f'{f}:{i+1}: {l.strip()[:220]}')
open('/tmp/h/stale2.txt','w').write('\n'.join(out))
print(len(out))
