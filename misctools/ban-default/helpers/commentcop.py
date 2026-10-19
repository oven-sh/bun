import re, subprocess, sys
base=sys.argv[1] if len(sys.argv)>1 else 'origin/main'
diff = subprocess.run(['git','diff',base,'--','src'],capture_output=True,text=True).stdout
SRC=re.compile(r'\.(rs|c|cc|cpp|h|hpp|m|mm|ts|tsx|mts|cts|js|jsx|mjs|cjs)$')
def is_comment(line):
    t=line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t in ('*','*/') or t.startswith('* ')
out=[]; cur=None; path=None; newline=0
def flush():
    global cur
    if cur and len(cur['lines'])>=2:
        text='\n'.join(cur['lines'])
        if 'SAFETY:' not in text: out.append((path,cur['start'],cur['end'],text))
    cur=None
for raw in diff.split('\n'):
    if raw.startswith('+++ b/'):
        flush(); path=raw[6:]; continue
    if raw.startswith('diff --git') or raw.startswith('--- ') or raw.startswith('index '):
        flush(); continue
    if raw.startswith('@@'):
        flush(); m=re.search(r'\+(\d+)',raw); newline=int(m.group(1)) if m else 1
    elif raw.startswith('+'):
        c=raw[1:]
        if path and SRC.search(path) and is_comment(c):
            if cur: cur['end']=newline; cur['lines'].append(c)
            else: cur={'start':newline,'end':newline,'lines':[c]}
        else: flush()
        newline+=1
    elif raw.startswith('-'):
        flush()
    elif raw.startswith('\\'):
        pass
    else:
        flush(); newline+=1
flush()
print(len(out))
for p,s,e,t in out:
    print(f'--- {p}:{s}-{e}')
    for l in t.split('\n'): print('    '+l.strip()[:170])
