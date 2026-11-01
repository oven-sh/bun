#!/usr/bin/env python3
# Translates pass 2 of the scaled IDCTs in jidctint.c into one generic 1-D Rust function per size.
import re,sys
src=open('/root/ref/libjpeg-turbo-patched/src/jidctint.c').read()
def split_args(s):
    depth=0;out=[];cur=''
    for ch in s:
        if ch=='(':depth+=1
        if ch==')':depth-=1
        if ch==',' and depth==0: out.append(cur.strip());cur=''
        else: cur+=ch
    out.append(cur.strip());return out
def find_call(s,name):
    i=s.find(name+'(')
    if i<0:return None
    j=i+len(name)+1;depth=1
    while depth:
        if s[j]=='(':depth+=1
        if s[j]==')':depth-=1
        j+=1
    return i,j,s[i+len(name)+1:j-1]
def simple(e): return re.fullmatch(r'-?[A-Za-z_0-9.]+(\([0-9.]+\))?',e) is not None
def whole(e):
    if not (e.startswith('(') and e.endswith(')')): return False
    d=0
    for i,ch in enumerate(e):
        if ch=='(':d+=1
        if ch==')':
            d-=1
            if d==0 and i!=len(e)-1: return False
    return True
def strip(e):
    while whole(e): e=e[1:-1]
    return e
def paren(e): return e if simple(e) or whole(e) else '('+e+')'
def conv(e):
    while True:
        c=find_call(e,'MULTIPLY')
        if c:
            i,j,a=c;x,y=split_args(a);e=e[:i]+paren(conv(x))+' * '+paren(conv(y))+e[j:];continue
        c=find_call(e,'LEFT_SHIFT')
        if c:
            i,j,a=c;x,y=split_args(a);e=e[:i]+'('+paren(conv(x))+' << '+paren(y)+')'+e[j:];continue
        break
    e=re.sub(r'\bFIX\(([0-9.]+)\)',r'fix(\1)',e)
    e=re.sub(r'\(JLONG\)wsptr\[(\d)\]',r'x\1',e)
    return e
out=[]
for n,k in [(3,3),(5,5),(6,6),(7,7),(10,8),(12,8),(14,8)]:
    m=re.search(r'\n_jpeg_idct_%dx%d\(.*?\n}\n'%(n,n),src,re.S)
    body=m.group(0);p2=body[body.index('Pass 2'):]
    p2=p2[p2.index('output_col;')+len('output_col;'):p2.index('wsptr +=')]
    p2=re.sub(r'/\*.*?\*/','',p2,flags=re.S)
    st=[re.sub(r'\s+',' ',x).strip() for x in p2.split(';')]
    st=[x for x in st if x]
    lines=[];outs={}
    assert re.fullmatch(r'(\w+) = \(JLONG\)wsptr\[0\] \+ \(ONE << \(PASS1_BITS \+ 2\)\)',st[0]),st[0]
    v=st[0].split(' ')[0]
    assert st[1]=='%s = LEFT_SHIFT(%s, CONST_BITS)'%(v,v),st[1]
    lines.append('let %s = dc;'%v)
    for s in st[2:]:
        mm=re.fullmatch(r'outptr\[(\d+)\] = range_limit\[\(int\)RIGHT_SHIFT\((.*), CONST_BITS \+ PASS1_BITS \+ 3\) & RANGE_MASK\]',s)
        if mm: outs[int(mm.group(1))]=conv(mm.group(2));continue
        mm=re.fullmatch(r'(\w+) (=|\+=|-=) (.*)',s)
        assert mm,s
        var,op,e=mm.groups();e=conv(e)
        if op=='=': lines.append('let %s = %s;'%(var,strip(e)))
        else: lines.append('let %s = %s %s %s;'%(var,var,op[0],paren(e)))
    assert sorted(outs)==list(range(n)),outs
    args=', '.join(['dc']+['x%d'%i for i in range(1,k)])
    out.append('#[inline(always)]\nfn idct%d<T: Int>([%s]: [T; %d]) -> [T; %d] {\n    %s\n    [%s]\n}\n'%(n,args,k,n,'\n    '.join(lines),', '.join(outs[i] for i in range(n))))
print('\n'.join(out))
