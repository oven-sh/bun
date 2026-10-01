import * as ns from "./mod";
import Def, { Foo as MFoo } from "./mod";
namespace NA { export interface Foo { na: 1 } export class Q { private z = 1 } }
namespace NB { export interface Foo { nb: 1 } export class Q { private z = 1 } }
declare let a: NA.Foo; declare let b: NB.Foo; a = b;
declare let qa: NA.Q; declare let qb: NB.Q; qa = qb;
declare let nv: never;
const sym = Symbol();
const anon = class { p = 1 };
const fexp = function () { return 1; };
const obj = { "quoted key": 1, 42: 2, [sym]: 3, ["comp" + "uted"]: 4, nested: { deep: () => 1 }, get g() { return 1; }, set s(v: number) {} };
nv = new anon(); nv = anon; nv = fexp; nv = obj; nv = ns; nv = new Def(); nv = Def;
declare let mf: MFoo; mf = 1 as any as NA.Foo;
ns.missing; obj.nope; NA.Nope; new ns.Pub().p;
interface I { req: string; ["comp-lit"]: number; 7: boolean }
const i: I = {};
class D { constructor(private x: number) {} method(): void {} }
class D2 extends D { method(a: string): void {} }
function over(x: string): void; function over(x: number): void; function over(x: any) {}
over(true);
