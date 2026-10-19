import re, subprocess
diff = subprocess.run(['git','diff','-U0','origin/main','--','src','test/internal','clippy.toml','Cargo.toml'],capture_output=True,text=True).stdout
cur=None; newline=0; out=[]
for l in diff.split('\n'):
    if l.startswith('+++ b/'): cur=l[6:]; continue
    m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', l)
    if m: newline=int(m.group(1)); continue
    if l.startswith('+') and not l.startswith('+++'):
        if '—' in l or '–' in l: out.append((cur,newline,l[1:]))
        newline+=1
for f,n,t in out: print(f'{f}:{n}: {t.strip()[:200]}')
print(len(out))
