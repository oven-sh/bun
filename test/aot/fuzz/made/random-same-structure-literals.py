#!/usr/bin/env python3
"""random-same-structure-literals.py <folder>: Random programs: a dozen and more literals of a few structures (alike, nearly alike: a name more, the order turned, another type, `as const`, nested, in arrays), in two files. Typed functions written against `typeof <one of them>` and against type literals read every field. Then a random walk of honest operations on single objects: typed stores of the right type, freeze, seal, another prototype, an accessor of the right type, a property more, Object.assign, spread, JSON there and back, arrays, Maps. After every step everything is printed. No lie about a type is told, so what plain Bun prints is the answer."""
import os, random, shutil, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd(); N=60
TS='{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["main.ts"] }\n'
for d in os.listdir(H):
    if os.path.isdir(os.path.join(H,d)): shutil.rmtree(os.path.join(H,d))
KINDS={'num':lambda R:R.choice(['0','1','-1','7','1.5','-0.25','4294967296','1e21','2147483647','-2147483648']),'str':lambda R:R.choice(['""','"a"','"bc"','"\\u00e9"','"a longer string than the others"']),'boo':lambda R:R.choice(['true','false']),'big':lambda R:R.choice(['0n','1n','-5n','123456789012345678901234567890n']),'nul':lambda R:'null',
       'arr':lambda R:'['+', '.join(R.choice(['1','2.5','-3']) for _ in range(R.randint(1,3)))+']','sar':lambda R:'['+', '.join(R.choice(['"x"','"yz"']) for _ in range(R.randint(1,3)))+']'}
TYPE={'num':'number','str':'string','boo':'boolean','big':'bigint','nul':'null','arr':'number[]','sar':'string[]'}
SHOW={'num':lambda e:'(%s + 1) + "/" + Object.is(%s, -0)'%(e,e),'str':lambda e:'%s.length + %s'%(e,e),'boo':lambda e:'(%s ? "T" : "F")'%e,'big':lambda e:'String(%s * 2n)'%e,'nul':lambda e:'String(%s)'%e,'arr':lambda e:'%s.length + ":" + %s.reduce((p, q) => p + q, 0)'%(e,e),'sar':lambda e:'%s.join("+")'%e}
for p in range(N):
    R=random.Random(1000+p); names=['a','b','c','d','e','kind','id','x']
    structs=[]
    for s in range(R.randint(2,4)):
        f=R.sample(names,R.randint(1,5)); structs.append([(n,R.choice(list(KINDS))) for n in f])
    base=R.choice(structs)
    if len(base)>1: structs.append(list(reversed(base)))                       # the order turned
    structs.append(base+[('z','num')])                                           # a name more
    structs.append([(n,('str' if k!='str' else 'num')) if i==0 else (n,k) for i,(n,k) in enumerate(base)])   # a type other
    def lit(st): return '{ '+', '.join('%s: %s'%(n,KINDS[k](R)) for n,k in st)+' }'
    objs=[]; main=[]; other=[]
    for i in range(R.randint(10,18)):
        si=R.randrange(len(structs)); where=R.choice(('main','main','other')); objs.append(('o%d'%i,si,where))
        (main if where=='main' else other).append(('const ' if where=='main' else 'export const ')+'o%d = %s;'%(i,lit(structs[si])))
    fns=[]
    for si,st in enumerate(structs):
        mine=[o for o,s,_ in objs if s==si]
        body=' + "," + '.join(SHOW[k]('v.'+n) for n,k in st)
        fns.append('function lit%d(v: { %s }): string { return %s + "|" + Object.keys(v).join("") }'%(si,'; '.join('%s: %s'%(n,TYPE[k]) for n,k in st),body))
        if mine: fns.append('function own%d(v: typeof %s): string { return %s }'%(si,R.choice(mine),body))
        else: fns.append('function own%d(v: { %s }): string { return %s }'%(si,'; '.join('%s: %s'%(n,TYPE[k]) for n,k in st),body))
    show='function all(): string { return ['+', '.join('t(() => lit%d(%s) + "~" + own%d(%s))'%(s,o,s,o) for o,s,_ in objs)+'].join(" ") }'
    steps=[]
    for _ in range(R.randint(8,16)):
        o,si,_w=R.choice(objs); st=structs[si]; n,k=R.choice(st); op=R.randrange(13)
        if op<=2: steps.append('t(() => { %s.%s = %s })'%(o,n,KINDS[k](R)) if k!='nul' else 't(() => 0)')
        elif op==3: steps.append('Object.freeze(%s)'%o)
        elif op==4: steps.append('Object.seal(%s)'%o)
        elif op==5: steps.append('Object.preventExtensions(%s)'%o)
        elif op==6: steps.append('t(() => Object.setPrototypeOf(%s, { inherited: 1 }))'%o)
        elif op==7: steps.append('t(() => Object.defineProperty(%s, "%s", { get() { return %s }, configurable: true, enumerable: true }))'%(o,n,KINDS[k](R)))
        elif op==8: steps.append('t(() => { (%s as any).more%d = %d })'%(o,R.randint(0,2),R.randint(0,9)))
        elif op==9:
            same=[x for x,s,_ in objs if s==si]; steps.append('t(() => Object.assign(%s, %s))'%(o,R.choice(same)))
        elif op==10: steps.append('console.log(JSON.stringify({ ...%s }, (_k, q) => typeof q === "bigint" ? String(q) : q))'%o)
        elif op==11:
            same=[x for x,s,_ in objs if s==si]; steps.append('console.log([%s].map(own%d).join(";"))'%(', '.join(R.sample(same,min(len(same),3))),si))
        else:
            x,y=R.choice(objs)[0],R.choice(objs)[0]; steps.append('console.log((%s as unknown) === %s)'%(x,y))
    imp=[o for o,_,wh in objs if wh=='other']
    text='declare const console: { log(...values: unknown[]): void };\n'+('import { %s } from "./other";\n'%', '.join(imp) if imp else '')+'function t(f: () => unknown): string { try { return String(f()) } catch (e) { return "THROWS " + (e as Error).name } }\n'+'\n'.join(main)+'\n'+'\n'.join(fns)+'\n'+show+'\nconsole.log(all());\n'+''.join(s+'; console.log(all());\n' for s in steps)
    d=os.path.join(H,'r%03d'%p); os.makedirs(d); open(os.path.join(d,'main.ts'),'w').write(text); open(os.path.join(d,'other.ts'),'w').write('\n'.join(other)+'\nexport {};\n'); open(os.path.join(d,'tsconfig.json'),'w').write(TS)
print(N,'programs')
