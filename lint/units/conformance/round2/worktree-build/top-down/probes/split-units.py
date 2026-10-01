# Simplified split of every multi-file case of the corpus at "// @filename:" (directive lines dropped), for the ASAN scans.
# Not the harness's materialisation: a robustness scan only. Writes /tmp/conf-wb-1b/allunits and allunits.list.
import os,re,shutil
root='/tmp/conf-wb-1b/scratch/test/cli/lint/conformance/corpus/cases'
out='/tmp/conf-wb-1b/allunits'
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
opt=re.compile(r'^//\s*@(\w+)\s*:\s*(.*?)\s*$')
files=[]; multi=0; cases=0
exts=re.compile(r'\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$')
for dirpath,_,names in os.walk(root):
    for nm in sorted(names):
        p=os.path.join(dirpath,nm); cases+=1
        text=open(p,'rb').read().decode('utf-8','replace')
        units=[]; cur=None; buf=[]; seen=False
        for line in text.split('\n'):
            m=opt.match(line.rstrip('\r'))
            if m:
                if m.group(1).lower()=='filename':
                    if cur is not None: units.append((cur,'\n'.join(buf)))
                    cur=m.group(2); buf=[]; seen=True
                continue
            buf.append(line)
        if cur is not None: units.append((cur,'\n'.join(buf)))
        if not seen: continue
        multi+=1
        for k,(name,body) in enumerate(units):
            if not exts.search(name): continue
            d=os.path.join(out,'%05d'%multi); os.makedirs(d,exist_ok=True)
            q=os.path.join(d, '%02d_'%k + name.replace('\\','/').strip('/').replace('/','__').replace(':','_'))
            open(q,'w',encoding='utf-8',newline='').write(body); files.append(os.path.relpath(q,out))
open('/tmp/conf-wb-1b/allunits.list','w').write('\n'.join(files)+'\n')
print('cases', cases, 'multi-file cases', multi, 'unit files written', len(files))
