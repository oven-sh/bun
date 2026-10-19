import re, subprocess
files = [f for f in subprocess.run(['git','ls-files','src'],capture_output=True,text=True).stdout.split('\n') if f.endswith('.rs')]
pat = re.compile(r'#!?\[(?:allow|expect|cfg_attr)\((?:[^\]"]|"(?:[^"\\]|\\[\s\S])*")*?\]', re.S)
n=0
for f in files:
    txt=open(f,encoding='utf8',errors='replace').read()
    if 'Default' not in txt and 'default()' not in txt: continue
    for m in pat.finditer(txt):
        a=m.group(0)
        if re.search(r'Default|default\(\)', a):
            ln=txt.count('\n',0,m.start())+1
            print(f'{f}:{ln}: {" ".join(a.split())[:300]}')
            n+=1
print(n)
