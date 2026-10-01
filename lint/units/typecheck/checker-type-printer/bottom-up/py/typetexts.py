# Extracts the arguments of the diagnostics of the reference's error baselines and classifies each argument text
# by the syntax that the type printer must support to produce it. Input: the tsgo baselines (submodule + local).
# usage: python3 typetexts.py <out dir>
import json,re,os,sys,collections,glob
R='/workspace/ref/typescript-go/'
out=sys.argv[1]
os.makedirs(out,exist_ok=True)
msgs={}
for k,v in json.load(open(R+'_submodules/TypeScript/src/compiler/diagnosticMessages.json')).items():
    msgs[v['code']]=k
for k,v in json.load(open(R+'internal/diagnostics/extraDiagnosticMessages.json')).items():
    msgs[v['code']]=k
rx={}
def regex(code):
    if code in rx: return rx[code]
    t=msgs.get(code)
    if t is None: rx[code]=None; return None
    parts=re.split(r'\{(\d+)\}',t)
    pat=''; idx=[]
    for i,p in enumerate(parts):
        if i%2==0: pat+=re.escape(p)
        else:
            idx.append(int(p)); pat+='(.*?)'
    rx[code]=(re.compile('^'+pat+'$',re.S),idx)
    return rx[code]
KEYWORDS={'any','unknown','string','number','bigint','boolean','symbol','void','undefined','null','never','object','true','false','this','unique symbol'}
IDENT=r'[A-Za-z_$][A-Za-z0-9_$]*'
def classify(s):
    if s in KEYWORDS: return '01-keyword'
    if re.fullmatch(r'-?\d[\d.eE+_-]*n?',s) or re.fullmatch(r'"(?:[^"\\]|\\.)*"',s): return '02-literal'
    if re.fullmatch(IDENT,s): return '03-identifier'
    if re.fullmatch(IDENT+r'(\.'+IDENT+r')+',s): return '04-qualified-name'
    toks=set()
    if '=>' in s: toks.add('function')
    if re.search(r'\bnew \(',s) or s.startswith('new ') or 'abstract new' in s: toks.add('constructor')
    if '{' in s: toks.add('object')
    if re.search(r'\[\]',s): toks.add('array')
    if re.search(r'\[[^\]]',s): toks.add('tuple-or-index')
    if '<' in s: toks.add('generic')
    if ' | ' in s: toks.add('union')
    if ' & ' in s: toks.add('intersection')
    if 'typeof ' in s: toks.add('typeof')
    if 'keyof ' in s: toks.add('keyof')
    if ' extends ' in s and ' ? ' in s: toks.add('conditional')
    if ' in ' in s and '{' in s: toks.add('mapped')
    if '`' in s: toks.add('template')
    if 'import(' in s: toks.add('import-type')
    if 'readonly ' in s: toks.add('readonly')
    if ' is ' in s: toks.add('predicate')
    if '...' in s: toks.add('rest-or-elision')
    if 'infer ' in s: toks.add('infer')
    if not toks:
        if re.fullmatch(r'[^\s]+',s): return '05-other-single-token'
        return '06-other-text'
    order=['import-type','conditional','infer','mapped','template','predicate','constructor','function','object','tuple-or-index','generic','intersection','union','array','typeof','keyof','readonly','rest-or-elision']
    for o in order:
        if o in toks: return '10-'+o
    return '10-misc'
files=sorted(glob.glob(R+'testdata/baselines/reference/submodule/compiler/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/submodule/conformance/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/compiler/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/conformance/*.errors.txt'))
head=re.compile(r'^(?:[^\s(][^(\n]*\(\d+,\d+\): )?(error|message|suggestion|warning) TS(\d+): (.*)$')
cls=collections.Counter(); clsex={}
percode=collections.defaultdict(collections.Counter)
fileworst={}
unmatched=collections.Counter()
nmsg=0
for f in files:
    try: txt=open(f,encoding='utf-8',errors='replace').read()
    except Exception: continue
    worst='00-no-arguments'
    # only the summary block at the top of the baseline: it ends at the first blank line pair
    topend=txt.find('\n\n\n')
    top=txt[:topend if topend>=0 else len(txt)].replace('\r','')
    lines=top.split('\n')
    i=0
    while i<len(lines):
        l=lines[i]
        body=l.lstrip(' ')
        m=head.match(body)
        if not m:
            # a chain line: indented message text without the code, not matched against a template
            i+=1; continue
        code=int(m.group(2)); text=m.group(3)
        nmsg+=1
        r=regex(code)
        args=None
        if r:
            mm=r[0].match(text)
            if mm: args=list(mm.groups())
        if args is None:
            unmatched[code]+=1
        else:
            for a in args:
                a=a.strip()
                if len(a)>=2 and a[0]=="'" and a[-1]=="'": a=a[1:-1]
                c=classify(a)
                cls[c]+=1; percode[code][c]+=1
                clsex.setdefault(c,(a[:100],os.path.basename(f)))
                if c>worst: worst=c
        i+=1
    # chain lines carry arguments too: classify every quoted text of the indented lines
    for l in lines:
        if l.startswith('  ') and not head.match(l.lstrip(' ')):
            for a in re.findall(r"'((?:[^']|'(?=[A-Za-z0-9_$-]+':))*)'",l):
                c=classify(a)
                cls[c]+=1
                clsex.setdefault(c,(a[:100],os.path.basename(f)))
                if c>worst: worst=c
    fileworst[os.path.basename(f)]=worst
with open(out+'/type-text-classes.tsv','w') as o:
    o.write('class\targuments\texample\texample baseline\n')
    for c in sorted(cls): o.write('%s\t%d\t%s\t%s\n'%(c,cls[c],clsex[c][0],clsex[c][1]))
fw=collections.Counter(fileworst.values())
with open(out+'/baseline-hardest-class.tsv','w') as o:
    o.write('baseline\thardest class\n')
    for k in sorted(fileworst): o.write(k+'\t'+fileworst[k]+'\n')
print('baselines',len(files),'messages',nmsg,'unmatched codes',sum(unmatched.values()))
acc=0
for c in sorted(fw):
    acc+=fw[c]
    print('%-26s baselines whose hardest argument is of this class: %5d   cumulative %5d'%(c,fw[c],acc))
print()
for c in sorted(cls): print('%-26s %6d  e.g. %s  (%s)'%(c,cls[c],clsex[c][0],clsex[c][1]))
