// RUN: lower
// DIAGNOSTIC: TS2339 row000.ts:2
// DIAGNOSTIC: TS2339 row001.ts:2
// DIAGNOSTIC: TS2339 row002.ts:2
// DIAGNOSTIC: TS2339 row003.ts:2
// DIAGNOSTIC: TS2339 row004.ts:2
// DIAGNOSTIC: TS2339 row005.ts:2
// DIAGNOSTIC: TS2339 row006.ts:2
// DIAGNOSTIC: TS2339 row007.ts:2
// DIAGNOSTIC: TS2339 row008.ts:2
// DIAGNOSTIC: TS2339 row009.ts:2
// DIAGNOSTIC: TS2339 row010.ts:2
// DIAGNOSTIC: TS2339 row011.ts:2
// DIAGNOSTIC: TS2339 row012.ts:2
// DIAGNOSTIC: TS2339 row013.ts:2
// DIAGNOSTIC: TS2339 row014.ts:2
// DIAGNOSTIC: TS2339 row015.ts:2
// DIAGNOSTIC: TS2339 row016.ts:2
// DIAGNOSTIC: TS2339 row017.ts:2
// DIAGNOSTIC: TS2339 row018.ts:2
// DIAGNOSTIC: TS2339 row019.ts:2
// DIAGNOSTIC: TS2339 row020.ts:2
// DIAGNOSTIC: TS2339 row021.ts:2
// DIAGNOSTIC: TS2339 row022.ts:2
// DIAGNOSTIC: TS2339 row023.ts:2
// DIAGNOSTIC: TS2339 row024.ts:2
// DIAGNOSTIC: TS2339 row025.ts:2
// DIAGNOSTIC: TS2339 row026.ts:2
// DIAGNOSTIC: TS2339 row027.ts:2
// DIAGNOSTIC: TS2339 row028.ts:2
// DIAGNOSTIC: TS2339 row029.ts:2
// DIAGNOSTIC: TS2339 row030.ts:2
// DIAGNOSTIC: TS2339 row031.ts:2
// DIAGNOSTIC: TS2339 row032.ts:2
// DIAGNOSTIC: TS2339 row033.ts:2
// DIAGNOSTIC: TS2339 row034.ts:2
// DIAGNOSTIC: TS2339 row035.ts:2
// DIAGNOSTIC: TS2339 row036.ts:2
// DIAGNOSTIC: TS2339 row037.ts:2
// DIAGNOSTIC: TS2339 row038.ts:2
// DIAGNOSTIC: TS2339 row039.ts:2
// DIAGNOSTIC: TS2339 row040.ts:2
// DIAGNOSTIC: TS2339 row041.ts:2
// DIAGNOSTIC: TS2339 row042.ts:2
// DIAGNOSTIC: TS2339 row043.ts:2
// DIAGNOSTIC: TS2339 row044.ts:2
// DIAGNOSTIC: TS2339 row045.ts:2
// DIAGNOSTIC: TS2339 row046.ts:2
// DIAGNOSTIC: TS2339 row047.ts:2
// DIAGNOSTIC: TS2339 row047.ts:3
// DIAGNOSTIC: TS2339 row047.ts:4
// DIAGNOSTIC: TS2339 row047.ts:5
// DIAGNOSTIC: TS2339 row047.ts:6
// DIAGNOSTIC: TS2339 row047.ts:7
// DIAGNOSTIC: TS2339 row048.ts:2
// DIAGNOSTIC: TS2339 row048.ts:3
// DIAGNOSTIC: TS2339 row048.ts:4
// DIAGNOSTIC: TS2339 row048.ts:5
// DIAGNOSTIC: TS2339 row049.ts:2
// DIAGNOSTIC: TS2339 row049.ts:3
// DIAGNOSTIC: TS2339 row049.ts:4
// DIAGNOSTIC: TS2339 row049.ts:5
// DIAGNOSTIC: TS2339 row050.ts:2
// DIAGNOSTIC: TS2339 row050.ts:3
// DIAGNOSTIC: TS2339 row050.ts:4
// DIAGNOSTIC: TS2339 row051.ts:2
// DIAGNOSTIC: TS2339 row051.ts:3
// DIAGNOSTIC: TS2339 row052.ts:2
// DIAGNOSTIC: TS2339 row053.ts:2
// DIAGNOSTIC: TS2339 row054.ts:2
// DIAGNOSTIC: TS2339 row055.ts:2
// DIAGNOSTIC: TS2339 row056.ts:2
// DIAGNOSTIC: TS2339 row057.ts:2
// DIAGNOSTIC: TS2339 row058.ts:2
// DIAGNOSTIC: TS2339 row059.ts:2
// DIAGNOSTIC: TS2339 row060.ts:2
// DIAGNOSTIC: TS2339 row061.ts:2
// DIAGNOSTIC: TS2339 row062.ts:2
// DIAGNOSTIC: TS2339 row063.ts:2
// DIAGNOSTIC: TS2339 row064.ts:2
// DIAGNOSTIC: TS2339 row065.ts:2
// DIAGNOSTIC: TS2339 row066.ts:2
// DIAGNOSTIC: TS2339 row067.ts:2
// DIAGNOSTIC: TS2339 row068.ts:2
// DIAGNOSTIC: TS2339 row069.ts:2
// DIAGNOSTIC: TS2339 row070.ts:2
// DIAGNOSTIC: TS2339 row070.ts:3
// DIAGNOSTIC: TS2339 row071.ts:2
// DIAGNOSTIC: TS2339 row071.ts:3
// DIAGNOSTIC: TS2339 row072.ts:2
// DIAGNOSTIC: TS2339 row073.ts:2
// DIAGNOSTIC: TS2339 row074.ts:2
// DIAGNOSTIC: TS2339 row075.ts:2
// DIAGNOSTIC: TS2339 row076.ts:2
// DIAGNOSTIC: TS2339 row077.ts:2
// DIAGNOSTIC: TS2339 row078.ts:2
// DIAGNOSTIC: TS2339 row079.ts:2
// DIAGNOSTIC: TS2339 row080.ts:2
// DIAGNOSTIC: TS1166 row013.ts:1

// A type error stops the build wherever it stands in code that runs. An error in code that nothing reaches does not, so this asks whether each place is known to be reached.

// FILE: main.ts
import "./row000.ts";
import "./row001.ts";
import "./row002.ts";
import "./row003.ts";
import "./row004.ts";
import "./row005.ts";
import "./row006.ts";
import "./row007.ts";
import "./row008.ts";
import "./row009.ts";
import "./row010.ts";
import "./row011.ts";
import "./row012.ts";
import "./row013.ts";
import "./row014.ts";
import "./row015.ts";
import "./row016.ts";
import "./row017.ts";
import "./row018.ts";
import "./row019.ts";
import "./row020.ts";
import "./row021.ts";
import "./row022.ts";
import "./row023.ts";
import "./row024.ts";
import "./row025.ts";
import "./row026.ts";
import "./row027.ts";
import "./row028.ts";
import "./row029.ts";
import "./row030.ts";
import "./row031.ts";
import "./row032.ts";
import "./row033.ts";
import "./row034.ts";
import "./row035.ts";
import "./row036.ts";
import "./row037.ts";
import "./row038.ts";
import "./row039.ts";
import "./row040.ts";
import "./row041.ts";
import "./row042.ts";
import "./row043.ts";
import "./row044.ts";
import "./row045.ts";
import "./row046.ts";
import "./row047.ts";
import "./row048.ts";
import "./row049.ts";
import "./row050.ts";
import "./row051.ts";
import "./row052.ts";
import "./row053.ts";
import "./row054.ts";
import "./row055.ts";
import "./row056.ts";
import "./row057.ts";
import "./row058.ts";
import "./row059.ts";
import "./row060.ts";
import "./row061.ts";
import "./row062.ts";
import "./row063.ts";
import "./row064.ts";
import "./row065.ts";
import "./row066.ts";
import "./row067.ts";
import "./row068.ts";
import "./row069.ts";
import "./row070.ts";
import "./row071.ts";
import "./row072.ts";
import "./row073.ts";
import "./row074.ts";
import "./row075.ts";
import "./row076.ts";
import "./row077.ts";
import "./row078.ts";
import "./row079.ts";
import "./row080.ts";

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"types":[]},"files":["main.ts","globals.d.ts"]}

// FILE: globals.d.ts
declare const process: { env: Record<string, string | undefined>; platform: string };
declare const Bun: object;
interface ImportMeta { url: string; main: boolean; env?: Record<string, string | undefined> }

// FILE: row000.ts
console.log((1 as number)
.nope);
export {};

// FILE: row001.ts
const a = (1 as number)
.nope; console.log(a);
export {};

// FILE: row002.ts
function f() { return (1 as number)
.nope; } console.log(f());
export {};

// FILE: row003.ts
function f(a = (1 as number)
.nope) { return a; } console.log(f());
export {};

// FILE: row004.ts
const f = (a = (1 as number)
.nope) => a; console.log(f());
export {};

// FILE: row005.ts
const f = () => (1 as number)
.nope; const g = () => f(); console.log(g());
export {};

// FILE: row006.ts
const f = function () { return (1 as number)
.nope; }; function g() { return f(); } console.log(g());
export {};

// FILE: row007.ts
const f = (a = (1 as number)
.nope) => a; const g = () => f(); console.log(g());
export {};

// FILE: row008.ts
const f = () => (1 as number)
.nope; function run(g: () => unknown) { return g(); } console.log(run(() => f()));
export {};

// FILE: row009.ts
class K { f = (1 as number)
.nope; } console.log(new K().f);
export {};

// FILE: row010.ts
class K { static f = (1 as number)
.nope; } console.log(K.f);
export {};

// FILE: row011.ts
class K { static { console.log((1 as number)
.nope); } } console.log(new K());
export {};

// FILE: row012.ts
class K { [String((1 as number)
.nope)]() {} } console.log(new K());
export {};

// FILE: row013.ts
class K { [String((1 as number)
.nope)] = 1; } console.log(new K());
export {};

// FILE: row014.ts
class K { get g() { return (1 as number)
.nope; } } console.log(new K().g);
export {};

// FILE: row015.ts
class K { set s(v: number) { console.log((1 as number)
.nope); } } new K().s = 1;
export {};

// FILE: row016.ts
class K { constructor(public p = (1 as number)
.nope) {} } console.log(new K().p);
export {};

// FILE: row017.ts
class K { m(a = (1 as number)
.nope) { return a; } } console.log(new K().m());
export {};

// FILE: row018.ts
class K { #p = (1 as number)
.nope; r() { return this.#p; } } console.log(new K().r());
export {};

// FILE: row019.ts
class K { accessor a = (1 as number)
.nope; } console.log(new K().a);
export {};

// FILE: row020.ts
class B {} class K extends ((1 as number)
.nope, B) {} console.log(new K());
export {};

// FILE: row021.ts
const d = (v: any, c: any) => v; @((1 as number)
.nope, d) class K {} console.log(new K());
export {};

// FILE: row022.ts
const d = (x: any) => (v: any, c: any) => v; class K { @d((1 as number)
.nope) f = 1; } console.log(new K());
export {};

// FILE: row023.ts
const d = (x: any) => (v: any, c: any) => v; @d((1 as number)
.nope) class K {} console.log(new K());
export {};

// FILE: row024.ts
const o = { a: (1 as number)
.nope }; console.log(o);
export {};

// FILE: row025.ts
const o = { [String((1 as number)
.nope)]: 1 }; console.log(o);
export {};

// FILE: row026.ts
const o = { ...{ a: (1 as number)
.nope } }; console.log(o);
export {};

// FILE: row027.ts
const o = { m() { return (1 as number)
.nope; } }; console.log(o.m());
export {};

// FILE: row028.ts
const o = { get g() { return (1 as number)
.nope; } }; console.log(o.g);
export {};

// FILE: row029.ts
const a = [(1 as number)
.nope]; console.log(a);
export {};

// FILE: row030.ts
const a = [...[(1 as number)
.nope]]; console.log(a);
export {};

// FILE: row031.ts
console.log(`${(1 as number)
.nope}`);
export {};

// FILE: row032.ts
console.log(String.raw`${(1 as number)
.nope}`);
export {};

// FILE: row033.ts
const { a = (1 as number)
.nope } = {} as { a?: unknown }; console.log(a);
export {};

// FILE: row034.ts
const [a = (1 as number)
.nope] = [] as unknown[]; console.log(a);
export {};

// FILE: row035.ts
for (const x of [(1 as number)
.nope]) console.log(x);
export {};

// FILE: row036.ts
for (const k in { [String((1 as number)
.nope)]: 1 }) console.log(k);
export {};

// FILE: row037.ts
for (let i = 0; i < 1; i++, (1 as number)
.nope) console.log(i);
export {};

// FILE: row038.ts
for (let i = ((1 as number)
.nope, 0); i < 1; i++) console.log(i);
export {};

// FILE: row039.ts
while ((1 as number)
.nope) break; console.log(1);
export {};

// FILE: row040.ts
do { console.log(1); } while ((1 as number)
.nope);
export {};

// FILE: row041.ts
if ((1 as number)
.nope) console.log(1); else console.log(2);
export {};

// FILE: row042.ts
switch ((1 as number)
.nope) { default: console.log(1); }
export {};

// FILE: row043.ts
switch (1 as number) { case (1 as number)
.nope: console.log(1); break; default: console.log(2); }
export {};

// FILE: row044.ts
try { throw (1 as number)
.nope; } catch (e) { console.log(e); }
export {};

// FILE: row045.ts
try { console.log(1); } finally { console.log((1 as number)
.nope); }
export {};

// FILE: row046.ts
label: { console.log((1 as number)
.nope); break label; }
export {};

// FILE: row047.ts
console.log((1 as number)
.nope ? 1 : 2, true ? (1 as number)
.nope : 2, (1 as number)
.nope ?? 1, (1 as number)
.nope || 1, (1 as number)
.nope && 1, ((1 as number)
.nope, 1));
export {};

// FILE: row048.ts
console.log(typeof (1 as number)
.nope, void (1 as number)
.nope, !(1 as number)
.nope, -(1 as number)
.nope);
export {};

// FILE: row049.ts
console.log(((1 as number)
.nope) as unknown, ((1 as number)
.nope)!, (1 as number)
.nope satisfies unknown, <unknown>(1 as number)
.nope);
export {};

// FILE: row050.ts
console.log(({} as any)[(1 as number)
.nope], ({} as any)?.[(1 as number)
.nope], ({} as any).f?.((1 as number)
.nope));
export {};

// FILE: row051.ts
console.log(new Array((1 as number)
.nope), new (class { constructor(a: unknown) {} })((1 as number)
.nope));
export {};

// FILE: row052.ts
enum E { A = (1 as number)
.nope } console.log(E.A);
export {};

// FILE: row053.ts
namespace N { export const a = (1 as number)
.nope; } console.log(N.a);
export {};

// FILE: row054.ts
namespace N { console.log((1 as number)
.nope); } console.log(1);
export {};

// FILE: row055.ts
function* g() { yield (1 as number)
.nope; } console.log([...g()]);
export {};

// FILE: row056.ts
async function f() { return await (1 as number)
.nope; } f().then(console.log);
export {};

// FILE: row057.ts
const f = async () => (1 as number)
.nope; f().then(console.log);
export {};

// FILE: row058.ts
console.log(await (1 as number)
.nope); export {};
export {};

// FILE: row059.ts
export default (1 as number)
.nope;
export {};

// FILE: row060.ts
export const a = (1 as number)
.nope; console.log(a);
export {};

// FILE: row061.ts
using u = ((1 as number)
.nope, null); console.log(1);
export {};

// FILE: row062.ts
console.log((() => (1 as number)
.nope)());
export {};

// FILE: row063.ts
console.log((function () { return (1 as number)
.nope; })());
export {};

// FILE: row064.ts
console.log([1].map(() => (1 as number)
.nope));
export {};

// FILE: row065.ts
setTimeout(() => console.log((1 as number)
.nope), 0);
export {};

// FILE: row066.ts
Promise.resolve().then(() => console.log((1 as number)
.nope));
export {};

// FILE: row067.ts
function f(this: unknown) { return (1 as number)
.nope; } console.log(f.call(null));
export {};

// FILE: row068.ts
function f(...r: unknown[]) { return r; } console.log(f(...[(1 as number)
.nope]));
export {};

// FILE: row069.ts
let a; a = (1 as number)
.nope; console.log(a);
export {};

// FILE: row070.ts
let a = 1 as unknown; a ??= (1 as number)
.nope; a ||= (1 as number)
.nope; console.log(a);
export {};

// FILE: row071.ts
const o: any = {}; o.p = (1 as number)
.nope; o[(1 as number)
.nope] = 1; console.log(o);
export {};

// FILE: row072.ts
console.log(import.meta.url.length + (1 as number)
.nope);
export {};

// FILE: row073.ts
function f<T>(a: T) { return a; } console.log(f<unknown>((1 as number)
.nope));
export {};

// FILE: row074.ts
const t = (s: TemplateStringsArray, ...v: unknown[]) => v; console.log(t`${(1 as number)
.nope}`);
export {};

// FILE: row075.ts
class K { static m() { return (1 as number)
.nope; } } console.log(K.m());
export {};

// FILE: row076.ts
abstract class A { m() { return (1 as number)
.nope; } } class K extends A {} console.log(new K().m());
export {};

// FILE: row077.ts
class A { m() { return 1 as unknown; } } class K extends A { m() { return (super.m(), (1 as number)
.nope); } } console.log(new K().m());
export {};

// FILE: row078.ts
const K = class { f = (1 as number)
.nope; }; console.log(new K().f);
export {};

// FILE: row079.ts
function outer() { function inner() { return (1 as number)
.nope; } return inner(); } console.log(outer());
export {};

// FILE: row080.ts
function outer() { class L { f = (1 as number)
.nope; } return new L().f; } console.log(outer());
export {};
