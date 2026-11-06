const S: string = process.argv[2] ?? "s";
const N: number = process.argv.length;
class K { m() { return 1; } }
class D extends K {}
function f(x: K | null, y: object, z: Function, w: unknown, v: K | (() => void), u: string | number) { return [typeof x, typeof y, typeof z, typeof w, typeof v, typeof u]; }
console.log(f(new K(), {}, f, 1, () => {}, 1), f(null, f, K, "t", new D(), "a"));
console.log(typeof {}, typeof [], typeof (() => 1), typeof function () {}, typeof class {}, typeof /a/, typeof new K(), typeof K, typeof new Proxy(function () {}, {}), typeof new Proxy({}, {}), typeof Symbol(), typeof 1n, typeof new Map(), typeof Map, typeof Math, typeof JSON, typeof null, typeof undefined);
let changed: unknown = 1; console.log(typeof changed); changed = "t"; console.log(typeof changed); changed = {}; console.log(typeof changed); changed = () => 1; console.log(typeof changed);
const proxied: K = new Proxy(function () {}, {}) as unknown as K; console.log(typeof proxied);
const made: object[] = [{}, f, new Proxy(f, {})]; for (const m of made) console.log(typeof m);
let effect = 0; console.log(typeof (effect++, () => 1), typeof [effect++], typeof { a: effect++ }, effect);
console.log('a' + 'b' + S + 'c' + 'd', S + 'a' + 'b', `a${'b'}${S}${'c'}d`, S + 1 + 'a', S + 'a' + 1 + 'b' + 'c', 1 + 'a' + 'b' + S, S + '' + 'x', S + 'x' + '', '' + S);
const pair = S + '\ud83d' + '\ude00'; console.log(pair.length, pair.codePointAt(S.length), pair.codePointAt(S.length + 1), [...pair].length, pair);
const wide = S + 'é' + 'λ' + 'x' + 'y' + 'モ'; console.log(wide, wide.length, wide.charCodeAt(S.length + 1));
const o = { toString() { effect += 10; return "o"; } }; console.log(o + 'a' + 'b', 'a' + 'b' + o, `${o}a${'b'}`, effect);
console.log(('x'.repeat(300) + S + 'y'.repeat(200) + 'z'.repeat(200)).length);
console.log('abc'.charCodeAt(1), 'abc'.charCodeAt(3), 'abc'.charCodeAt(-1), 'abc'.charCodeAt(1.5), ('abc' as any).charCodeAt(), 'é'.charCodeAt(0), '\ud83d'.charCodeAt(0), ''.charCodeAt(0), 'λ'.codePointAt(0), 'abc'.at(0), 'abc'[1], 'abc'[3], 'abc'[-1], 'abc'['1'], 'λa'[1], '😀'[1].charCodeAt(0));
const log: string[] = [];
function res(name: string) { return { [Symbol.dispose]() { log.push("dispose " + name); } }; }
function ares(name: string) { return { async [Symbol.asyncDispose]() { log.push("adispose " + name); } }; }
{ using a = null; using b = undefined; using c = res("c"); using d = null; log.push("in " + a + b + (c ? 1 : 0) + d); }
log.push("out");
{ const none = null; using a = none; using b = void 0; log.push("void " + a + b); }
for (const i of [1, 2]) { using a = null; if (i === 1) continue; log.push("loop " + a); }
for (using a of [null, res("head"), undefined]) log.push("head " + (a === null ? "null" : a === undefined ? "undefined" : "res"));
function early() { using a = null; using b = res("early"); return a; } log.push("early " + early());
function thrower() { using a = null; try { using b = res("t"); throw new Error("x"); } catch (e) { log.push("caught " + (e as Error).message); } return a; } thrower();
try { using bad = 1 as unknown as Disposable; log.push("unreachable " + bad); } catch (e) { log.push((e as Error).name); }
try { using bad = {} as unknown as Disposable; log.push("unreachable " + bad); } catch (e) { log.push((e as Error).name); }
{ using a = (N > 100 ? res("no") : null); log.push("computed " + a); }
console.log(log.join("\n"));
async function waits() {
  const seen: string[] = []; const later = Promise.resolve().then(() => seen.push("microtask"));
  { await using a = null; seen.push("in " + a); }
  seen.push("after a"); await later;
  { await using b = undefined; await using c = ares("c"); using d = null; seen.push("in2 " + b + (c ? 1 : 0) + d); }
  return seen.concat(log.slice(-1));
}
waits().then(r => console.log(r.join(",")));
class E { declare a: number; b?: number; c!: number; d = 1; } const e = new E(); console.log(Object.keys(e), e.a, e.b, e.c, e.d, "a" in e, "b" in e);
