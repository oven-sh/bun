#!/usr/bin/env python3
"""casts-to-optional-member-type.py <folder>: `x as Opt` of an `unknown` that the program has made itself; Opt is otherwise made by literals of the program alone. One maker and one road a program."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
head = '''declare const console: { log(...values: unknown[]): void };
type Opt = { a?: number; b?: string };
const own: Opt = { a: 2, b: "own" };
function takes(o: Opt): string { return String(o.a) + "," + String(o.b) }
'''
makers = {
 'literal': 'function make(): unknown { return { a: 1, z: 9 } }',
 'exact': 'function make(): unknown { return { a: 1, b: "m" } }',
 'instance': 'class P { a = 1; b = "p"; m() { return 1 } }\nfunction make(): unknown { return new P() }',
 'thrown': 'function make(): unknown { try { throw { a: 1, code: "E" } } catch (e) { return e } }',
 'an_error': 'function make(): unknown { try { throw Object.assign(new Error("m"), { a: 1 }) } catch (e) { return e } }',
 'other': 'type Req = { kind: string; a: number };\nconst r: Req = { kind: "k", a: 1 };\nfunction make(): unknown { return r }',
 'created': 'function make(): unknown { return Object.create({ a: 1 }) }',
 'array': 'function make(): unknown { return [1, 2] }',
 'closure': 'function make(): unknown { return () => 1 }',
}
roads = {
 'read': 'console.log((make() as Opt).a, (make() as Opt).b, takes(own));',
 'parameter': 'console.log(takes(make() as Opt), takes(own));',
 'variable': 'const o = make() as Opt; console.log(takes(o), o.a, takes(own));',
 'annotated': 'const o: Opt = make() as Opt; console.log(takes(o), o.a, takes(own));',
 'field': 'class H { o: Opt; constructor(o: Opt) { this.o = o } s() { return takes(this.o) } }\nconsole.log(new H(make() as Opt).s(), new H(own).s());',
 'array': 'const l: Opt[] = [own]; l.push(make() as Opt); console.log(l.map(takes).join(" "));',
 'result': 'function get(): Opt { return make() as Opt }\nconsole.log(takes(get()), get().a, takes(own));',
 'inferred': 'function get() { return make() as Opt }\nconsole.log(takes(get()), get().a, takes(own));',
 'member': 'const h: { o: Opt } = { o: own }; h.o = make() as Opt; console.log(takes(h.o), h.o.a);',
 'store': 'const o = make() as Opt; let s: string; try { o.b = "set"; s = "stored" } catch (e) { s = "threw " + (e as Error).name } console.log(s, o.b, takes(own));',
 'either': 'const o = own.a === 2 ? make() as Opt : own; console.log(takes(o), takes(own));',
 'loop': 'let s = ""; for (const o of [make() as Opt, own, make() as Opt]) s += takes(o) + " "; console.log(s);',
}
for m, maker in makers.items():
    for r, road in roads.items():
        open('%s/%s_%s.ts' % (H, m, r), 'w').write(head + maker + '\n' + road + '\n')
print(len(makers) * len(roads))
