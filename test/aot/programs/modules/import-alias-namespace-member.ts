// `import a = N.b` compiles to `const a = N.b`: it captures the member's value when the statement runs.
namespace local {
  export function h() { return "h"; }
  export const v = 5;
  export class K { x = 1; static s = "s"; }
  export enum E { A = 1, B }
  export const enum CE { P = 10, Q = 20 }
  export let m = 1;
  export function bump() { m++; }
  export let f = () => "first";
  export const obj = { x: 1, y: { z: 2 } };
  export let arr = [1, 2];
  export namespace deep { export const w = 7; export let n = 1; export namespace most { export function g() { return "g"; } } }
}
import h = local.h;
import v = local.v;
import K = local.K;
import E = local.E;
import A = local.E.A;
import CE = local.CE;
import P = local.CE.P;
import m = local.m;
import f = local.f;
import obj = local.obj;
import arr = local.arr;
import whole = local;
import deep = local.deep;
import deeper = whole.deep;
import w = deep.w;
import n = local.deep.n;
import g = local.deep.most.g;

const k: K = new K();
console.log(h(), typeof h, h === local.h, [1].map(h).join());
console.log(v, k.x, K.s, k instanceof K, K === local.K, E.A, E[2], A, CE.Q, P, typeof E);

local.bump();
console.log(m, local.m);
local.m = 9;
console.log(m, local.m, whole.m);
local.f = () => "second";
console.log(f(), local.f());
local.obj.x = 10;
local.arr = [3];
console.log(obj.x, obj.y.z, obj === local.obj, arr.join(), local.arr.join());
local.deep.n = 2;
console.log(whole === local, deep.w, deeper === deep, w, n, deep.n, g());

const later = () => m + h();
async function soon() { await null; return m + h(); }
function* each() { yield m; yield h(); }
class Uses { field = m; get() { return m + h(); } static fixed = m; }
console.log(later(), new Uses().field, new Uses().get(), Uses.fixed, [...each()].join());
soon().then(console.log);

function shadowed(m: string) { return m + v; }
function inner() { const v = "inner"; return v + m; }
console.log(shadowed("parameter"), inner());

namespace A1 { export let v = 1; export function f() { return "f" + v; } export class K { x = 1; } }
namespace B1 { import v = A1.v; import f = A1.f; export function g() { return v + ":" + f(); } }
namespace B2 { export import v = A1.v; export import f = A1.f; export import K = A1.K; export function own() { return v; } export function called() { return f(); } }
A1.v = 2;
console.log(B1.g(), Object.keys(B1).join());
console.log(B2.v, A1.v, B2.f(), new B2.K().x, B2.K === A1.K, Object.keys(B2).join(), B2.own(), B2.called());
B2.v = 5;
console.log(B2.v, A1.v, B2.own());

namespace A2 { export let v = 1; export function f() { return "f"; } }
namespace B3 { export import v = A2.v; export import f = A2.f; export function own() { return v + f(); } }
import v3 = B3.v;
import f3 = B3.f;
import own3 = B3.own;
A2.v = 2;
console.log(v3, f3(), own3());

function merged() { return "called"; }
namespace merged { export const extra = "extra"; export let count = 1; }
import extra = merged.extra;
import count = merged.count;
import same = merged;
merged.count = 2;
console.log(extra, count, same(), same.extra, same === merged);
