#!/usr/bin/env python3
"""argument-omitted-by-untyped-code.py <folder>: A parameter of a method that untyped code is seen to leave out. A folder a row: lib.ts (typed), caller.js (untyped, of the program), main.ts."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
TS='{ "compilerOptions": { "strict": true, "allowJs": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["main.ts"] }\n'
MAIN='declare const console: { log(...values: unknown[]): void };\n// @ts-ignore\nimport { run } from "./caller.js";\nfor (const line of run() as string[]) console.log(line);\n'
TRY='function t(label, f) { let r; try { r = String(f()) } catch (e) { r = "THROWS " + e.name } return label + ": " + r }\n'
def show(p): return 'typeof %s + ":" + String(%s)'%(p,p)
rows={
 'm01_a_method':('export class C { m(a: number, b: number): string { return %s } }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("none", () => new C().m()), t("both", () => new C().m(1, 2))'),
 'm02_a_static_method':('export class C { static m(a: number, b: number): string { return %s } }'%show('b'),'import { C } from "./lib";\n','t("one", () => C.m(1)), t("both", () => C.m(1, 2))'),
 'm03_a_constructor':('export class C { s: string; constructor(a: number, b: number) { this.s = %s } }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C(1).s), t("both", () => new C(1, 2).s)'),
 'm04_a_rest_parameter':('export class C { m(a: number, ...rest: number[]): string { return rest.length + ":" + Array.isArray(rest) } }','import { C } from "./lib";\n','t("none", () => new C().m()), t("one", () => new C().m(1)), t("three", () => new C().m(1, 2, 3))'),
 'm05_a_default':('export class C { m(a: number, b: number = 7): string { return %s } }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm06_a_this_parameter':('export class C { v = 3; m(this: C, a: number, b: number): string { return this.v + " " + %s } }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm07_inherited':('export class B { m(a: number, b: number): string { return %s } }\nexport class C extends B { }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm08_overridden':('export class B { m(a: number, b: number): string { return "B " + %s } }\nexport class C extends B { override m(a: number, b: number): string { return "C " + %s + " then " + super.m(a, b) } }'%(show('b'),show('b')),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm09_an_object_parameter':('export class C { m(a: number, b: { x: number }): string { return typeof b + ":" + (b === undefined ? "none" : b.x) } }','import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, { x: 2 }))'),
 'm10_used_as_a_number':('export class C { m(a: number, b: number): string { return String(a + b) + " " + String(b * 2) + " " + String(b > 1) } }','import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm11_handed_on_to_typed_code':('function inner(x: number): string { return typeof x + ":" + String(x + 1) }\nexport class C { m(a: number, b: number): string { return inner(b) } }','import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm12_stored_to_a_field':('export class C { f: number = 0; m(a: number, b: number): string { this.f = b; return typeof this.f + ":" + String(this.f) } }','import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm13_by_a_computed_name':('export class C { m(a: number, b: number): string { return %s } }'%show('b'),'import { C } from "./lib";\nconst name = ["m"][0];\n','t("one", () => new C()[name](1)), t("both", () => new C()[name](1, 2))'),
 'm14_by_value':('export class C { m(a: number, b: number): string { return %s } }'%show('b'),'import { C } from "./lib";\n','t("call", () => { const c = new C(), f = c.m; return f.call(c, 1) }), t("apply", () => { const c = new C(); return c.m.apply(c, [1]) }), t("bind", () => { const c = new C(); return c.m.bind(c)(1) }), t("reflect", () => Reflect.apply(C.prototype.m, new C(), [1]))'),
 'm15_a_spread':('export class C { m(a: number, b: number): string { return %s } }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(...[1])), t("both", () => new C().m(...[1, 2]))'),
 'm16_an_arrow_field':('export class C { m = (a: number, b: number): string => %s }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm17_a_method_of_a_literal':('export const o = { m(a: number, b: number): string { return %s } };'%show('b'),'import { o } from "./lib";\n','t("one", () => o.m(1)), t("both", () => o.m(1, 2))'),
 'm18_async_and_generator':('export class C { async m(a: number, b: number): Promise<string> { return %s } *g(a: number, b: number): Generator<string> { yield %s } }'%(show('b'),show('b')),'import { C } from "./lib";\n','t("generator", () => [...new C().g(1)].join()), t("async is a promise", () => new C().m(1) instanceof Promise)'),
 'm19_a_private_method_behind':('export class C { #p(a: number, b: number): string { return %s } m(a: number, b: number): string { return this.#p(a, b) } }'%show('b'),'import { C } from "./lib";\n','t("one", () => new C().m(1)), t("both", () => new C().m(1, 2))'),
 'm20_two_classes_one_name':('export class C { m(a: number, b: number): string { return "C " + %s } }\nexport class D { m(a: number, b: string, c: boolean): string { return "D " + %s + " " + %s } }'%(show('b'),show('b'),show('c')),'import { C, D } from "./lib";\n','t("C one", () => new C().m(1)), t("D two", () => new D().m(1, "s")), t("D all", () => new D().m(1, "s", true))'),
 'm21_typed_code_also_calls':('export class C { m(a: number, b: number): string { return %s } }\nexport function typed(): string { return new C().m(1, 2) }'%show('b'),'import { C, typed } from "./lib";\n','t("typed", () => typed()), t("one", () => new C().m(1))'),
 'm22_a_setter_and_a_getter':('export class C { _v = 0; set v(x: number) { this._v = x } get v(): number { return this._v } }','import { C } from "./lib";\n','t("set", () => { const c = new C(); c.v = 5; return c.v })'),
 'm23_super_construct':('export class B { s: string; constructor(a: number, b: number) { this.s = %s } }'%show('b'),'import { B } from "./lib";\nclass U extends B { constructor() { super(1) } }\n','t("one", () => new U().s)'),
 'm24_too_many':('export class C { m(a: number): string { return typeof a + ":" + String(a) + " " + arguments.length } }','import { C } from "./lib";\n','t("three", () => new C().m(1, 2, 3))'),
}
for name,(lib,imp,calls) in rows.items():
    d=os.path.join(H,name); os.makedirs(d,exist_ok=True)
    open(os.path.join(d,'lib.ts'),'w').write(lib+'\n'); open(os.path.join(d,'caller.js'),'w').write(imp+TRY+'export function run() { return ['+calls+'] }\n'); open(os.path.join(d,'main.ts'),'w').write(MAIN); open(os.path.join(d,'tsconfig.json'),'w').write(TS)
print(len(rows),'folders')
