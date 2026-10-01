// Research scratch: own sources for the code path mapping, where the tests of ESLint say little. Writes own-js.json and own-ts.json.
"use strict";
const fs = require("fs");
const js = String.raw`
try { [a, b] = x; } finally { f(); }
try { ({a, b: c, ...d} = x); } finally {}
try { var {a = 1, b: [c, ...d]} = x; } finally {}
try { let [a = b ? c : d] = e } catch (e) { g() } finally { h() }
function f() { try { new.target } finally {} }
try { import.meta } finally {}
try { this.x } finally {}
class A extends B { m() { try { super.x } finally {} } }
try { x = <a.b/>; } catch {}
function f() { try { return <Foo/>; } catch { x(); } }
function f() { try { return <Foo a={b}/>; } catch { x(); } }
function f() { try { return <a.b>{c}</a.b>; } catch { x(); } finally { y } }
try { label: for (a of b) { continue label; } } finally {}
try { for (a in b) ; } finally {}
try { for ([a] of b) ; } finally {}
try { for (a.b of c); } finally {}
try { for ({a} of c); } finally {}
try { for ([a = 1, ...b] of c); } finally {}
try { ({a}) } finally {}
try { ({a: b}) } finally {}
try { ({[a]: b}) } finally {}
try { ({a() {}}) } finally {}
try { ({...a}) } finally {}
try { ({get a() { return b }, set a(c) {}}) } finally {}
try { class A extends B { [c] = d; static [e]() {} } } finally {}
try { class A { static x = y; z } } finally {}
try { a?.b } finally {}
try { a?.[b] } finally {}
try { a?.() } finally {}
try { a?.b.c(d)?.e } finally {}
try { ${"`${a}`"} } finally {}
try { tag${"`${a}`"} } finally {}
function* g() { try { yield a } finally {} }
async function g() { try { await a } finally {} }
try { a++ } finally {}
try { delete a.b } finally {}
try { typeof a } finally {}
try { function f(a = b) {} } finally {}
try { (a = b) => c } finally {}
try { ({a = 1} = b) } finally {}
try { ({a: b = 1} = c) } finally {}
try { [a = 1] = b } finally {}
try { [...a] = b } finally {}
try { ({...a} = b) } finally {}
try { [[a], {b}] = c } finally {}
try { [a.b, c[d]] = e } finally {}
try {} catch ({a}) { } finally {}
try {} catch ([a, b = c]) { } finally {}
try {} catch (e) { f } finally {}
try {} catch { a } finally { b }
try { a } catch { b }
try { a } catch (e) { b } finally { c }
try { import("x") } finally {}
try { new A } finally {}
try { a, b } finally {}
try { var a; var b = c; } finally {}
try { let a = b, c = d; } finally {}
try { a: b: c; } finally {}
l: try { break l; } finally {}
try { a = b } finally {}
try { a += b } finally {}
try { a &&= b } finally {}
try { a.b ||= c } finally {}
try { a ??= b ? c : d } finally {}
try { if (a) b; else c; } finally {}
try { switch (a) { case b: c; default: d } } finally {}
try { var {[a]: b} = c } finally {}
try { var {a: {b}} = c } finally {}
try { var [, a] = c } finally {}
try { [, a] = c } finally {}
try { 1; "a"; null; this; /x/; 1n; } finally {}
try { ${"`a`"} } finally {}
try { (function () {}); (() => {}); (class {}); } finally {}
try { x = a => b } finally {}
function f() { try { return 1; } catch { x(); } }
function f() { try { return a; } catch { x(); } }
function f() { try { throw 1; } catch { x(); } y(); }
function f() { try { return 1; } finally { x(); } y(); }
function f() { try { return a; } catch (e) { return b; } finally { x(); } y(); }
function f() { try { try { return a; } finally { b; } } catch (e) { c; } finally { d; } e; }
function f() { try { a; } catch (e) { try { b; } finally { c; } } finally { d; } }
function f() { for (;;) { try { if (a) break; else continue; } finally { b; } } c; }
function f() { l: for (;;) { try { break l; } finally { b; } } c; }
function f() { while (a) { try { return; } finally { continue; } } }
function f({a = 1, b: [c = 2]}, ...rest) {}
(({a}) => a);
(function ([a, b] = c, {d} = e) {});
class A { a = b ? c : d; static e = () => { return 1 }; f; [g] = h; static { if (i) j; } }
class A { static { return_; } static { try { a } finally { b } } }
class A { a = () => { b }; c = function () { return d }; e = class { f = g } }
class A { get a() { return 1 } set a(v) {} static get b() { if (c) return 1; } }
({ get a() { return 1 }, set a(v) {}, b() {}, *c() { yield 1 }, async d() { await 1 } });
a: { if (b) break a; c; }
a: if (b) { break a; }
a: b: while (c) { continue b; break a; }
a: for (;;) { b: for (;;) { continue a; } }
a: switch (b) { case 1: break a; }
a: do { continue a; } while (b)
a: b: c: for (;;) break b;
a: { b: { break a; } c; }
a: for (x of y) { for (z in w) { continue a; } }
while (1) {} x;
while ("a") {} x;
while ('') {} x;
while (0n) {} x;
while (1n) {} x;
while (0x0n) {} x;
while (0b0n) {} x;
while (0o0n) {} x;
while (1_0n) {} x;
while (0.0) {} x;
while (0e0) {} x;
while (1e-400) {} x;
while (NaN) {} x;
while (null) {} x;
while (/a/) {} x;
while (${"`a`"}) {} x;
while (-1) {} x;
while (!0) {} x;
while (void 0) {} x;
while (true) { break; } x;
while ((true)) {} x;
while (true, true) {} x;
while (undefined) {} x;
for (;1;) {} x;
for (;;) {} x;
for (;"";) {} x;
do {} while (1); x;
do { continue; } while (true); x;
do { break; } while (true); x;
for (;true;) { if (a) break; } x;
(a && b) ?? c;
a || (b && c) || d;
(a ?? b) || c;
a ? b : c ? d : e;
x = a || b;
x ||= a && b;
x &&= (a ||= b);
(a, b) && c;
!(a && b);
if ((a && b)) {}
if (!(a && b)) {}
if (a && b || c && d) {} else {}
for (;a && b;) {}
while (a ?? b) {}
do {} while (a || b && c)
a = b ? c && d : e || f;
(a && b)();
(a || b).c;
f(a && b, c || d);
[a && b];
({x: a && b});
${"`${a && b}`"};
a && (b, c);
a + (b && c);
(a && b) + c;
a && b + c;
a + b && c + d;
a + b + c + d && e;
a && b && c && d;
a || b || c || d;
a ?? b ?? c;
a && b || c;
a || b && c;
if (a || b || c) d; else e;
if (a && (b || c)) d;
if ((a || b) && c) d;
while (a && b || c) d;
x = (a && b) ? c : d;
x = a && b ? c : d;
x = a ? b : c && d;
if (a ? b : c) d;
if ((a, b)) c;
if (a = b && c) d;
if (a ||= b) c;
if ((a ||= b) && c) d;
a ||= b ||= c;
a ||= b && c;
(a || b) ? (c && d) : (e ?? f);
a?.b?.c;
a?.b.c?.d.e;
(a?.b)?.c;
(a?.b).c?.d;
((a?.b)).c;
((a?.b))?.c;
a?.[b?.c];
a?.(b?.c, d?.());
a?.b();
a?.b?.();
a?.()?.b;
(a?.())?.();
new (a?.b)();
a?.b ?? c;
a?.b || c?.d;
if (a?.b) {} else {}
a?.b ? c : d;
delete a?.b;
class A { #b; m(a) { return a?.#b; } }
class A { #c; m(a) { return a?.b.#c; } }
class A { #c; m(a) { return #c in a; } }
a?.b[c]?.[d](e)?.(f);
a?.(b && c)?.[d || e];
a?.b(c ? d : e).f?.g;
(a?.b(c))?.d;
(a.b)?.c;
a.b?.c.d;
a?.();
a?.().b;
(a?.()).b;
a?.b?.c?.();
switch (a) {}
switch (a) { default: }
switch (a) { case 1: }
switch (a) { case 1: case 2: b; break; default: c }
switch (a) { default: b; case 1: c; }
switch (a) { case 1: ; }
switch (a) { case 1: {} }
switch (a) { default: ; case 1: b }
switch (a) { default: case 1: b }
switch (a) { case 1: b; default: }
switch (a) { case 1: b; default: case 2: c }
function f() { switch (a) { case 1: return; case 2: throw b; default: break; } c; }
switch (a) { case 1: switch (b) { case 2: break; default: c; } d; }
switch (a) { case b && c: d; case e ? f : g: h; }
function f() { switch (a) { case 1: return 1; default: return 2; } x; }
function f() { switch (a) { default: return 2; } x; }
function f() { switch (a) { case 1: return 2; } x; }
function f() { switch (a) { case 1: break; default: return; } x; }
"use strict"; a;
function f() { "use strict"; return; ; a; }
function f() { "use strict"; "use asm"; "other"; return; }
;;
if (a) ; else ;
for (;;) ;
a: ;
function f() { return; ; ; b(); }
function f() { return; a(); ; b(); }
{ { a; } }
if (a) { function f() {} }
async function f() { for await (a of b) { await c; } }
function* g() { yield* a; const x = yield; }
function* g() { try { yield a; } finally { b } }
function* g() { try { yield a; yield b; } catch (e) { yield c; } finally { yield d; } }
function* g() { while (a) { yield b; if (c) return; } }
a => b ? c : d;
a => ({ b });
(() => { return a; })();
(function () { return a; })();
async () => { await a; };
async a => await b;
export default a ? b : c;
export default function () { return }
export default class { m() {} }
export const a = b || c;
export { a as b }; import x from "y"; export * from "z";
export function f() { return; a; }
export default async function* g() { yield a; }
for (var a = b ? c : d; e; f) g;
for (let [a, b] of c) {}
for (const {a = 1} of b) {}
for (a.b in c) {}
for (var a in b) {}
for (a = 0, b = 1; a < b; a++, b--) {}
for (a in b) if (c) break; else continue;
for (var a = 1 in b) {}
for (const a of b) { if (c) continue; d; }
debugger;
throw a;
new a(b && c);
import(a ? b : c);
a = function () {} ? b : c;
<a b={c ? d : e} {...f}>{g && h}<i.j/></a>;
<></>;
<a>{/* c */}</a>;
<a b="c" d='e'>text {f} {...g}</a>;
a ? <b/> : <c/>;
function f() { if (a) { return 1; } else if (b) { return 2; } else { throw c; } d; }
function f() { if (a) return; b; return; c; }
function f() { for (;;) { if (a) return; } b; }
function f() { do { if (a) break; } while (true); b; }
function f() { a: for (;;) { for (;;) { break a; } b; } c; }
function f() { while (true) { try { return; } catch (e) { continue; } finally { a; } } }
function f() { return a && b; c; }
function f() { throw a ? b : c; d; }
function f() { var a = 1; return; var b; var c = 2; function g() {} }
var f = function () { return; x; };
class A { constructor() { super(); return; x; } }
class A extends B { constructor() { if (a) super(); else super(b); this.c; } }
class A extends B { constructor() { a && super(); this.b; } }
class A extends B { constructor() { try { super(); } finally { this.a; } } }
class A extends B { constructor() { while (a) { super(); } } }
x = y => { for (const a of b) if (a) return a; };
with (a) { b; }
with (a) b ? c : d;
if (a) b; else if (c) d; else e;
if (a) { if (b) c; } else d;
a ? b ? c : d : e;
a; b; c;
var a = 1, b = a ? 2 : 3, [c, d = a] = e;
let { a, b: { c = 1 } = {}, ...d } = e;
x = [a, ...b, , c];
x = { a, b: c, ...d, [e]: f, g() {}, get h() { return 1 } };
x = a${"`b`"} + c${"`d${e}f${g}`"};
x = a ** b ** c;
x = a + b * c - d / e % f;
x = a < b > c instanceof d in e;
x = (a, b, c);
x = yield_;
x = async function* () { for await (const a of b) yield a; };
function f(a, b = a, { c, d = b } = {}, [e, ...g] = [], ...h) { return }
`.split("\n").map(s => s.trim()).filter(Boolean);
const ts = String.raw`
if ((a && b) as boolean) c; else d;
if ((a && b)!) c;
if (<boolean>(a && b)) c;
if ((a && b) satisfies boolean) c;
if ((a && b)) c;
if (((a && b) as any) || c) d;
while (true as boolean) {} x;
while (true!) {} x;
while (<any>1) {} x;
while (true satisfies boolean) {} x;
while ((true)) {} x;
for (;(true as any);) {} x;
do {} while (true satisfies boolean); x;
x = (a || b) as any || c;
((a && b) as any) && c;
(a as any) && b;
a && (b as any);
a && (b || c) as any;
a && ((b || c) as any);
x = (a ?? b)! ?? c;
a?.b!.c;
(a?.b)!.c;
a?.b!;
a!?.b;
(a?.b as any).c;
(a?.b as any)?.c;
a?.b!?.c;
a?.b!();
a?.b!.c?.d!;
(a?.b!).c;
a?.b<T>();
f<T>(a);
new A<T>();
x = <T>a.b;
x = y! ? a : b;
x = (y as any) ? a : b;
enum E { A = a ? 1 : 2, B }
const enum F { A }
declare enum G { A }
namespace N { if (a) b; export function f() { return } }
namespace A.B { c; }
declare namespace D { function f(): void; }
module M { }
namespace N { export const a = b ? c : d; }
interface I {}
type T = {};
declare function f(): void;
function f(a: string): void; function f(a: any) { return }
declare const x: number;
declare class C { m(): void }
abstract class A extends B { abstract m(): void; abstract x: number; declare y: string; z!: number; w?: number = 1; constructor(private a = 1, public b?: string) { super(); } n(): void; n(a?: any) {} }
export = a;
import x = require("y");
import type {A} from "b"; export type {A};
export as namespace X;
@d class A { @e m() {} @f p = 1; constructor(@g a) {} }
@(a ? b : c) class B {}
class A { @(a || b) m() {} }
class A { accessor a = b ? c : d; static accessor e = 1 }
class A { constructor(private a = b || c) {} }
function f(this: Foo, a = 1) {}
x = <T,>(a: T) => a;
x = async <T,>(a: T) => { await a };
function f() { try { let x: Foo; return 1; } catch { g(); } }
function f() { try { let x: Foo = y as Bar; } finally {} }
function f() { try { const g = (a: A): B => c; } finally {} }
function f() { try { type T = U; interface I {} } finally { } }
function f() { try { let x: typeof y; return 1; } catch { g(); } }
function f() { try { let x: number; return 1; } catch { g(); } }
function f() { try { let x: { a: b }; return 1; } catch { g(); } }
function f() { try { function g(a: A): void; function g(a: any) {} return 1; } catch { h(); } }
function f() { try { let x = 1 as Foo; return 1; } catch { g(); } }
function f() { try { let x = <Foo>1; return 1; } catch { g(); } }
function f() { try { g<Foo>; return 1; } catch { h(); } }
class A { x = (a ? b : c) as T }
class A { x!: number; y?: string; z: number = a || b; readonly w = 1; private static v = () => 1 }
class A { [k: string]: any; m(): void; m(a?: any) {} }
class A { m(); m(a?) { return a } }
for (const x of y as any[]) {}
for (let i = 0 as number; i < n; i++) {}
label: for (const a of b) { break label; }
export default interface I {}
export declare const x: number;
export abstract class A {}
export enum E { A }
export namespace N { export const a = 1; }
import a = b.c;
switch (a) { case 1: type T = 1; break; case 2: interface I {} }
switch (a) { case 1: declare const x: number; }
switch (a) { case 1: type T = 1; }
switch (a) { default: type T = 1; case 1: b }
a<b>(c);
x = a<b>;
let x!: number;
let x: number = a ? b : c;
function f<T>(a: T = b as T): T { return a }
function f(a?: number, ...b: string[]) {}
const f = (a: number = 1, { b }: { b: number } = c): void => {};
x = y as unknown as T;
x = a satisfies B;
x = a!;
x = a!!;
x = (a)!;
if (a!) b;
if (a as boolean) b;
while (a!) {}
x = a! && b!;
x = (a && b)!;
x = a && b!;
x = (a! && b)!;
class A<T> extends B<T> implements C { constructor() { super(); } }
class A { constructor(); constructor(a?: any) {} }
class A extends B { constructor(); constructor(a?: any) { super(); } x = 1; }
class A extends B { x = 1; constructor(a: number) {} y = 2; static z = 3; declare w: number; m() {} u = 4; v = 5; }
declare module "m" { export const a: number; }
declare global { interface Window {} }
namespace N { interface I {} }
namespace N { export type T = number; const a = 1; }
function f() { return; type T = 1; }
function f() { return; interface I {} a(); }
function f() { return; a(); interface I {} b(); }
function f() { return; declare const x: number; }
function f() { return; enum E { A } }
function f() { return; namespace N { a; } }
function f() { return; function g(): void; function g() {} }
function f() { return; class C {} abstract class D {} declare class E {} }
function f() { return; const enum E { A } }
function f() { return; import x = require("y"); }
function f() { return; let x: number; var y: number; var z: number = 1; }
throw a; export interface I {} export type T = number; export declare const x: number; export const y = 1;
x = a as const;
x = { a: 1 } satisfies T;
x = [a, b] as const;
for (const [a, b] of c as [A, B][]) {}
try { a } catch (e: unknown) { b }
try { a } catch ({ message }: any) { b } finally { c }
function assertIsString(a: any): asserts a is string { if (typeof a !== "string") throw new Error(); }
function f(a: number): a is 1 { return a === 1 }
x = function <T>(this: T) { return this };
class A { static { let x: number = a ? 1 : 2; } }
class A { private x?: number = (() => { return 1 })(); }
using a = b;
async function f() { await using a = b; }
x = a?.b! ?? c;
x = a?.[b]!.c;
(a as any)?.b;
(<any>a)?.b;
(a!)?.b;
a!.b?.c;
a?.b as any;
if (a?.b!) c;
`.split("\n").map(s => s.trim()).filter(Boolean);
fs.writeFileSync("own-js.json", JSON.stringify(js.map(code => ({ rule: "own", code, kind: "js", jsx: true }))));
fs.writeFileSync("own-ts.json", JSON.stringify(ts.map(code => ({ rule: "own", code, kind: "ts", jsx: false }))));
console.log(js.length, ts.length);
