import re, subprocess, sys
files=[l[3:] for l in subprocess.run(['git','status','--short'],capture_output=True,text=True).stdout.split('\n') if l.strip()]
NOT_CODE = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|\'\\?"\'|\b[bc]?r(#*)"[\s\S]*?"\1|"(?:[^"\\]|\\[\s\S])*"')
def code_tokens(s):
    def repl(m):
        t=m.group(0)
        if t.startswith('//') or t.startswith('/*'): return ' '
        return t
    return NOT_CODE.sub(repl, s).split()
bad=[]
for f in files:
    if not f.endswith('.rs'):
        print('non-rs changed:', f); continue
    old=subprocess.run(['git','show','HEAD:'+f],capture_output=True,text=True).stdout
    new=open(f).read()
    if code_tokens(old)!=code_tokens(new):
        bad.append(f)
print('files changed', len(files), 'with code changes:', bad)
