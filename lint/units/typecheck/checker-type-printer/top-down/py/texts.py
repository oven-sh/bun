# Extracts the distinct argument texts of the diagnostics in the reference's error baselines (submodule compiler and
# conformance): the summary lines are matched against the message templates, the chain lines give their quoted texts.
# usage: python3 texts.py <out file, one text per line>
import json,re,sys,glob,collections
R='/workspace/ref/typescript-go/'
msgs={}
for k,v in json.load(open(R+'_submodules/TypeScript/src/compiler/diagnosticMessages.json')).items(): msgs[v['code']]=k
for k,v in json.load(open(R+'internal/diagnostics/extraDiagnosticMessages.json')).items(): msgs[v['code']]=k
rx={}
def regex(code):
    if code not in rx:
        t=msgs.get(code)
        if t is None: rx[code]=None
        else:
            parts=re.split(r'\{(\d+)\}',t); pat=''
            for i,p in enumerate(parts): pat+=re.escape(p) if i%2==0 else '(.*?)'
            rx[code]=re.compile('^'+pat+'$',re.S)
    return rx[code]
head=re.compile(r'^(?:[^\s(][^(\n]*\(\d+,\d+\): )?(error|message|suggestion|warning) TS(\d+): (.*)$')
files=sorted(glob.glob(R+'testdata/baselines/reference/submodule/compiler/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/submodule/conformance/*.errors.txt'))
texts=collections.Counter(); nmsg=0
for f in files:
    txt=open(f,encoding='utf-8',errors='replace').read().replace('\r','')
    top=txt.split('\n\n\n')[0]
    for l in top.split('\n'):
        m=head.match(l.lstrip(' '))
        if m and not l.startswith(' '):
            nmsg+=1
            r=regex(int(m.group(2)))
            mm=r.match(m.group(3)) if r else None
            if mm:
                for a in mm.groups():
                    a=a.strip()
                    if len(a)>=2 and a[0]=="'" and a[-1]=="'": a=a[1:-1]
                    if a and '\n' not in a: texts[a]+=1
        elif l.startswith('  '):
            body=l.strip()
            mm=None
            # a chain line has no code: try every template that starts with the same word
            for a in re.findall(r"'((?:[^']|'(?=[A-Za-z0-9_$-]+':))*)'",body):
                if a and '\n' not in a: texts[a]+=1
with open(sys.argv[1],'w',encoding='utf-8') as o:
    for a,_ in sorted(texts.items()): o.write(a+'\n')
print('baselines',len(files),'summary messages',nmsg,'distinct texts',len(texts),'occurrences',sum(texts.values()))
