// Functions that return promises, one to four levels deep, beside jobs, ticks and handlers of others: everything that runs is printed in its order.
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (v === null || typeof v !== "object" ? typeof v + ":" + String(v) : Array.isArray(v) ? "[" + v.map(show).join() + "]" : JSON.stringify(v));
class Species<T> extends Promise<T> { static get [Symbol.species]() { log("species"); return Promise as any; } }
class Logged<T> extends Promise<T> { then(a?: any, b?: any): any { log("Logged.then"); return super.then(a, b); } }
const kept = Promise.resolve("kept"), item: any = { n: 1 }, items = Promise.resolve(item);
let late = Promise.withResolvers<any>();
async function soon(n: any): Promise<any> { await null; return n; }
async function fails(n: any): Promise<any> { throw new Error("f" + n); }
async function failsLate(n: any): Promise<any> { await null; throw new Error("l" + n); }
const getterThen = (n: any): any => ({ get then() { log("get then"); return (f: any) => { log("call then"); f(n); }; } });
const getterThrows = (n: any): any => ({ get then(): any { log("get throws"); throw new Error("g" + n); } });
const twice = (n: any): any => ({ then(f: any, j: any) { f(getterThen(n)); j(new Error("no")); } });
const ownThen = (p: any): any => { p.then = function (a: any, b: any) { log("own then"); return Promise.prototype.then.call(this, a, b); }; return p; };
const ownGetter = (p: any): any => Object.defineProperty(p, "then", { get() { log("own getter"); return Promise.prototype.then; } });
const ownConstructor = (p: any): any => Object.defineProperty(p, "constructor", { get() { log("own constructor"); return Species; } });
const leaves: ((n: any) => any)[] = [
  n => Promise.resolve(n), n => n, () => kept, n => soon(n), n => fails(n), n => failsLate(n), n => getterThen(n), n => getterThrows(n), n => twice(n), n => new Species<any>(r => r(n)), n => Species.resolve(n), n => Logged.resolve(n) as any,
  n => ownThen(Promise.resolve(n)), n => ownGetter(Promise.resolve(n)), n => ownConstructor(Promise.resolve(n)), n => new Promise<any>(r => r(Promise.resolve(n))), n => new Promise<any>(r => r(getterThen(n))), () => items, () => late.promise,
  n => Promise.resolve(n).then(v => { log("leaf then"); return v; }), n => Promise.resolve(n).finally(() => log("leaf finally")), n => Promise.reject(new Error("r" + n)),
];
async function one(k: number, n: any): Promise<any> { return leaves[k](n); }
async function settled(n: any): Promise<any> { return Promise.resolve(n); }
async function two(k: number, n: any): Promise<any> { log("two"); return one(k, n); }
async function three(k: number, n: any): Promise<any> { queueMicrotask(() => log("q3")); return two(k, n); }
const four = async (k: number, n: any): Promise<any> => three(k, n);
async function between(k: number, n: any): Promise<any> { await null; return two(k, n); }
async function caught(k: number, n: any): Promise<any> { try { return await one(k, n); } catch (e: any) { log("caught " + e.message); return two(0, n); } finally { log("fin"); } }
async function settledBehind(n: any): Promise<any> { await null; queueMicrotask(() => log("behind")); return Promise.resolve(n); }
async function keptBehind(): Promise<any> { await null; process.nextTick(() => log("tick behind")); queueMicrotask(() => log("kept behind")); return kept; }
async function pendingBehind(n: any): Promise<any> { await null; const { promise, resolve } = Promise.withResolvers<any>(); queueMicrotask(() => { log("resolves"); resolve(n); }); queueMicrotask(() => log("after")); return promise; }
async function pendingAhead(n: any): Promise<any> { const { promise, resolve } = Promise.withResolvers<any>(); queueMicrotask(() => { log("resolves"); resolve(n); }); return promise; }
async function heldThenAwaited(n: any): Promise<any> { const p = settled(n); queueMicrotask(() => log("held")); const v = await p; log("has " + v); const q = two(0, n), r = settled(n); log("both"); log(show(await q)); log(show(await r)); return v; }
async function heldByTwo(n: any): Promise<any> { const p = four(0, n); void p.then(v => log("also " + v)); const v = await p; log("has " + v); return p; }
async function besideLoop(n: any): Promise<string> { let s = ""; for (let i = 0; i < 4; i++) { const p = settled(i); if (i & 1) queueMicrotask(() => log("odd")); s += show(await p) + show(await settledBehind(i)) + show(await pendingBehind(n)); log("l" + i); } return s; }
class Deep { static async run(k: number, n: any): Promise<any> { return k & 1 ? four(k, n) : one(k, n); } async run(k: number, n: any): Promise<any> { return Deep.run(k, n); } }
const deep = new Deep(), plain = (k: number, n: any): Promise<any> => one(k, n);
const ways: ((k: number, n: any) => Promise<any>)[] = [one, two, three, four, between, caught, Deep.run, (k, n) => deep.run(k, n), plain, (k, n) => (k & 1 ? settledBehind(n) : keptBehind()), (k, n) => (k & 1 ? pendingBehind(n) : pendingAhead(n)), (k, n) => (k & 1 ? heldThenAwaited(n) : heldByTwo(n)), (_, n) => besideLoop(n)];
async function ticks(name: string, m: number): Promise<void> { for (let i = 0; i < m; i++) { log(name + i); await null; } }
async function alone(way: number, k: number): Promise<any> { return await ways[way](k, 1); }
async function loops(way: number, k: number): Promise<string> { let s = ""; for (let i = 0; i < 3; i++) { if (i === 1) queueMicrotask(() => log("beside")); s += show(await ways[way](k, i)); log(i); } return s; }
async function known(): Promise<string> { let s = ""; for (let i = 0; i < 4; i++) { if (i === 2) queueMicrotask(() => log("beside known")); s += show(await settled(i)) + show(await one(0, i)); log("k" + i); } return s; }
async function knownOnce(): Promise<string> { queueMicrotask(() => log("other")); const a = await settled(1); log("a"); const b = await two(0, 2); log("b"); process.nextTick(() => log("tick")); const c = await four(2, 3); log("c"); return show(a) + show(b) + show(c); }
async function handlers(way: number, k: number): Promise<void> {
  const p = ways[way](k, 2);
  queueMicrotask(() => log("m1"));
  Promise.resolve(p).then(v => log("then " + show(v)), e => log("else " + e.message));
  Promise.resolve(p).finally(() => log("finally")).catch(() => log("catch"));
  queueMicrotask(() => log("m2"));
  try { log("await " + show(await p)); } finally { await ticks("z", 5); }
}
process.on("unhandledRejection", (e: any) => log("unhandled " + e?.message));
async function main() {
  for (let round = 0; round < 2; round++) {
    log("# " + round + (await known()) + (await knownOnce()));
    for (let i = 0; i < 3; i++) { log(show(await settledBehind(i))); log(show(await keptBehind())); log(show(await pendingBehind(i))); log(show(await pendingAhead(i))); log(show(await heldThenAwaited(i))); log(show(await heldByTwo(i))); log(await besideLoop(i)); }
    queueMicrotask(() => log("first")); log(show(await settledBehind(1))); log(show(await heldThenAwaited(1))); await Promise.all([ticks("v", 9), settledBehind(2), heldThenAwaited(2), besideLoop(2), ticks("w", 9)]);
    if (round === 1) { (item as any).then = function (f: any) { log("item then"); f("from item"); }; late = Promise.withResolvers<any>(); queueMicrotask(() => queueMicrotask(() => late.resolve("late"))); } else late.resolve("early");
    for (let way = 0; way < ways.length; way++) {
      for (let k = 0; k < leaves.length; k++) {
        log(`-- ${way} ${k}`);
        try { log(show(await alone(way, k))); } catch (e: any) { log("threw " + e.message); }
        try { log(await loops(way, k)); } catch (e: any) { log("threw " + e.message); }
        if ((way + k) % 3 === 0) try { await handlers(way, k); } catch (e: any) { log("threw " + e.message); }
        if ((way + k) % 5 === 0) { const r = await Promise.allSettled([ways[way](k, 1), ticks("t", 6), ways[way](k, 2)]); log(r.map(s => s.status[0]).join("")); }
      }
      void ways[way](4, 9); void ways[way](0, 9); await ticks("u", 8);
    }
  }
}
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 61 === 0 || i < 60).join("\n"));
