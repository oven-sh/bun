// The first await of an async function: what is awaited, what stays alive across it, and who handles what it throws.
class Box { constructor(public n: number) {} async twice(): Promise<number> { const v = await this.n; return v * 2; } }
const later = <T>(v: T): Promise<T> => new Promise(r => setTimeout(() => r(v), 0));
async function plain(a: number, b: string): Promise<string> { const x = await later(a); return b + x; }
async function notAPromise(a: number): Promise<number> { return (await a) + 1; }
async function thenable(): Promise<string> { return await ({ then(ok: (v: string) => void) { ok("thenable"); } } as any); }
async function rejected(): Promise<string> { try { await Promise.reject(new Error("no")); return "not reached"; } catch (e) { return "caught " + (e as Error).message; } }
async function unwatched(): Promise<number> { await Promise.reject(new RangeError("out")); return 1; }
async function twoRoads(c: boolean, s: string): Promise<string> { if (c) { const a = await later(s + "1"); return a; } const b = await later(s + "2"); return b + b; }
async function mayReturnFirst(c: boolean): Promise<number> { if (c) return 7; return await later(8); }
async function inLoop(xs: number[]): Promise<number> { let t = 0; for (const x of xs) t += await later(x); return t; }
async function manyAlive(a: number, b: number, c: string, d: boolean, e: number[], f: { k: string }): Promise<string> {
  const g = a + b, h = c + c, i = !d, j = e.length;
  const w = await later("w");
  return [a, b, c, d, e.join(), f.k, g, h, i, j, w].join("|");
}
async function doubles(x: number, y: number): Promise<number> { const z = x / 3; const w = await later(y / 7); return z + w; }
async function withFinally(log: string[]): Promise<string> { try { log.push("in"); return await later("v"); } finally { log.push("out"); } }
const arrow = async (n: number) => { const m = await later(n); return m + n; };
function maker(k: number) { return async (n: number) => (await later(n)) + k; }
async function nested(n: number): Promise<number> { return n <= 0 ? await later(0) : 1 + (await nested(n - 1)); }
async function traced(): Promise<string> { await later(0); return (new Error("t").stack ?? "").split("\n").filter(l => l.includes("traced") || l.includes("outer")).length > 0 ? "has frames" : "no frames"; }
async function outer(): Promise<string> { return await traced(); }
async function garbage(n: number): Promise<number> {
  const keep: Promise<number>[] = [];
  for (let i = 0; i < n; i++) keep.push(plainNumber(i));
  let t = 0; for (const p of keep) t += await p; return t;
}
async function plainNumber(i: number): Promise<number> { const junk = new Array(16).fill(i); const v = await later(i); return v + junk.length; }
async function* gen(n: number) { for (let i = 0; i < n; i++) yield await later(i); }
async function overGen(): Promise<number> { let t = 0; for await (const v of gen(4)) t += v; return t; }
async function main() {
  const log: string[] = [];
  console.log(await plain(1, "b"), await notAPromise(1), await thenable(), await rejected());
  console.log(await unwatched().catch(e => e.name + ":" + e.message));
  console.log(await twoRoads(true, "s"), await twoRoads(false, "s"), await mayReturnFirst(true), await mayReturnFirst(false));
  console.log(await inLoop([1, 2, 3]), await inLoop([]), await manyAlive(1, 2, "c", true, [4, 5], { k: "k" }));
  console.log(await doubles(1, 2), await withFinally(log), log.join(), await arrow(3), await maker(10)(1), await nested(5));
  console.log(await outer(), await new Box(21).twice(), await overGen(), await garbage(20000));
  const order: string[] = [];
  const a = (async () => { order.push("a1"); await null; order.push("a2"); await null; order.push("a3"); })();
  const b = (async () => { order.push("b1"); await null; order.push("b2"); })();
  order.push("sync"); await a; await b; console.log(order.join());
}
main();
