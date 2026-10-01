# Writes the distinct argument texts of the reference's error baselines, with the syntax class of typetexts.py
# and the number of baselines that contain the text: the input corpus of the printer round-trip test.
# usage: python3 typecorpus.py <out.tsv>      columns: class, baselines, text (one line each, texts with a newline are dropped)
import json,re,os,sys,collections,glob,importlib.util
here=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(here,'typetexts.py')).read()
# reuse classify() and the message regexes of typetexts.py without running its main part
head_src=src.split("files=sorted(")[0].replace("out=sys.argv[1]\nos.makedirs(out,exist_ok=True)\n","")
ns={}
exec(compile(head_src,'typetexts-head','exec'),ns)
R=ns['R']; regex=ns['regex']; classify=ns['classify']
files=sorted(glob.glob(R+'testdata/baselines/reference/submodule/compiler/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/submodule/conformance/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/compiler/*.errors.txt')+glob.glob(R+'testdata/baselines/reference/conformance/*.errors.txt'))
head=re.compile(r'^(?:[^\s(][^(\n]*\(\d+,\d+\): )?(error|message|suggestion|warning) TS(\d+): (.*)$')
seen=collections.defaultdict(set)
for f in files:
    txt=open(f,encoding='utf-8',errors='replace').read()
    topend=txt.find('\n\n\n')
    top=txt[:topend if topend>=0 else len(txt)].replace('\r','')
    for l in top.split('\n'):
        m=head.match(l.lstrip(' '))
        if m:
            r=regex(int(m.group(2)))
            if r:
                mm=r[0].match(m.group(3))
                if mm:
                    for a in mm.groups():
                        a=a.strip()
                        if len(a)>=2 and a[0]=="'" and a[-1]=="'": a=a[1:-1]
                        seen[a].add(os.path.basename(f))
        elif l.startswith('  '):
            for a in re.findall(r"'((?:[^']|'(?=[A-Za-z0-9_$-]+':))*)'",l):
                seen[a].add(os.path.basename(f))
with open(sys.argv[1],'w',encoding='utf-8') as o:
    n=0
    for a in sorted(seen):
        if '\n' in a or '\t' in a or not a: continue
        o.write('%s\t%d\t%s\n'%(classify(a),len(seen[a]),a)); n+=1
print('distinct texts',n)
