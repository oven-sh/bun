import re, subprocess
files = [f for f in subprocess.run(['git','ls-files','src'],capture_output=True,text=True).stdout.split('\n') if f.endswith('.rs')]
NOT_CODE = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|\'\\?"\'|\b[bc]?r(#*)"[\s\S]*?"\1|"(?:[^"\\]|\\[\s\S])*"')
def mask(s):
    return NOT_CODE.sub(lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s)
pat = re.compile(r'(?:[A-Za-z_][A-Za-z0-9_]*(?:::<[^;{}()]*?>)?|>)\s*::\s*default\b(?!\s*_)')
pat2 = re.compile(r'\.(unwrap_or_default|or_default|get_or_insert_default)\s*\(|\bmem::take\s*\(|\btake\s*\(&mut ')
out=[]; out2=[]
for f in files:
    txt=open(f,encoding='utf8',errors='replace').read()
    if 'default' not in txt and 'take' not in txt: continue
    code=mask(txt)
    lines=txt.split('\n')
    for m in pat.finditer(code):
        ln=code.count('\n',0,m.start())+1
        out.append(f'{f}:{ln}: {lines[ln-1].strip()[:170]}')
    for m in pat2.finditer(code):
        ln=code.count('\n',0,m.start())+1
        out2.append(f'{f}:{ln}: {lines[ln-1].strip()[:170]}')
open('/tmp/h/default_calls.txt','w').write('\n'.join(out))
open('/tmp/h/take_calls.txt','w').write('\n'.join(out2))
print(len(out), len(out2))
