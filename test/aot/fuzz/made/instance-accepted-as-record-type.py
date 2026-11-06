#!/usr/bin/env python3
"""instance-accepted-as-record-type.py <folder>: An instance of a class is admitted as it is to a record type that it does not fit. What could go wrong: a field that the instance HAS under the same name WITH ANOTHER TYPE, which the record type reads or stores as its own. One program for each type of the class and each type of the record. As plain Bun, or a throw; never a wrong value."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
K={'number':('number','7','V + 1'),'string':('string','"text"','V.length'),'boolean':('boolean','true','(V ? 1 : 2)'),'object':('{ k: number }','{ k: 5 }','V.k'),'array':('number[]','[1, 2, 3]','V.length'),'double':('number','1.5','V * 2'),'func':('() => number','() => 9','V()')}
for x in K:
    for y in K:
        if x==y or {x,y}=={'number','double'}: continue
        tx,vx,ux=K[x]; ty,vy,uy=K[y]
        open(os.path.join(H,'%s_seen_as_%s.ts'%(x,y)),'w').write('''// made by make.py: the class holds a %s, the view says %s.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { const v = f(); console.log(name + ": " + typeof v + " " + (typeof v === "function" ? "f" : typeof v === "object" ? JSON.stringify(v) : String(v))) } catch (e) { console.log(name + ": THROWS " + (e as Error).name) } }
declare const JSON: { stringify(value: unknown): string };
interface Wide { tag: number }
class C implements Wide { tag = 1; v: %s = %s; own(): unknown { const V = this.v; return %s } }
interface R extends Wide { v: %s; w: number }
function read(r: R): unknown { return r.v }
function use(r: R): unknown { const V = r.v; return %s }
function store(r: R): void { r.v = %s }
function more(r: R): unknown { r.w = 4; return r.w + r.tag }
const c = new C();
const wide: Wide = c;
row("the cast", () => (wide as R) === (c as unknown));
row("read", () => read(wide as R));
row("used as the view says", () => use(wide as R));
row("what the view has more", () => more(wide as R));
row("the class's own use", () => c.own());
row("stored as the view says", () => { store(wide as R); return read(wide as R) });
row("the class's own use behind the store", () => c.own());
row("keys", () => Object.keys(c).join());
for (let i = 0; i < 3; i++) row("again " + i, () => use(wide as R));
''' % (x,y,tx,vx,ux,ty,uy,vy))
print('made')
