// `await` on the promise of a known async function, after the program has given the promise its own `then` or another `constructor`, or passed it through other functions.
declare const console: { log(...v: unknown[]): void };
const log = (...v: unknown[]) => console.log(...v);
async function num(n: number): Promise<number> { return (n * 2) | 0; }
async function late(n: number): Promise<number> { await null; return (n * 3) | 0; }
async function text(n: number): Promise<string> { return "t" + n; }
async function either(n: number): Promise<number | string> { if (n & 1) return n; await null; return "even " + n; }
async function nothing(_n: number): Promise<void> { await null; }
async function maybe(n: number): Promise<number | undefined> { if (n > 2) return n; }
async function fails(n: number): Promise<number> { if (n > 0) throw new Error("fails " + n); return n; }
async function failsLate(n: number): Promise<number> { await null; if (n > 0) throw new RangeError("late " + n); return n; }
interface Box { v: number }
async function boxed(n: number): Promise<Box> { return { v: n }; }
async function thenable(n: number): Promise<unknown> { return { then(resolve: (x: unknown) => void) { resolve("from then " + n); } }; }

async function atOnce(): Promise<void> {
  log("at once", (await num(4)) + 1, (await late(4)) + 1, (await text(5)).length, await either(1), await either(2), await nothing(0), await maybe(1), await maybe(3), (await boxed(6)).v, await thenable(7));
  let s = 0; for (let i = 0; i < 5; i++) s = (s + (await num(i)) * (await late(i))) | 0; log("in a loop", s);
}
async function caught(): Promise<void> {
  try { log("not reached", (await fails(1)) + 1); } catch (e) { log("caught", String(e)); }
  try { log("not reached", (await failsLate(2)) + 1); } catch (e) { log("caught", String(e)); } finally { log("finally"); }
  try { log("reached", (await fails(0)) + 1, (await failsLate(0)) + 1); } catch (e) { log("not caught", String(e)); }
}
async function row(name: string, body: () => Promise<unknown>): Promise<void> { try { log(name, await body()); } catch (e) { log(name, "THREW", String(e).slice(0, 40)); } }
async function inHand(): Promise<void> {
  await row("awaited twice", async () => { await null; const p = num(10); const a = await p; const b = await p; return a + b; });
  await row("an own then, the same constructor", async () => { await null; const q: any = num(11); q.then = (resolve: (x: unknown) => void) => resolve("own then"); return await q; });
  await row("fulfilled, another constructor", async () => { await null; const r: any = num(12); r.constructor = function Other() {}; r.then = (resolve: (x: unknown) => void) => resolve("own then, another constructor"); return await r; });
  await row("pending, another constructor", async () => { await null; const r: any = late(12); r.constructor = function Other() {}; r.then = (resolve: (x: unknown) => void) => resolve("own then, pending"); return await r; });
  await row("fulfilled, patched through another name", async () => { await null; const t = num(13); const u: any = t; u.constructor = function Other() {}; u.then = (resolve: (x: unknown) => void) => resolve(1300); const w = await t; return typeof w + " " + w; });
  await row("fulfilled, patched in a function it was handed to", async () => { await null; const t = num(14); patch(t, 1400); const w = await t; return typeof w + " " + w; });
  await row("handed back by a plain function", async () => { await null; const w = await again(15); return typeof w + " " + w; });
  await row("from an array", async () => { await null; const kept: Promise<number>[] = [num(1), late(2)]; return (await kept[0]) + (await kept[1]); });
  await row("all", async () => (await Promise.all([num(1), late(2), text(3)])).join());
}
function patch(p: unknown, n: number): void { const u: any = p; u.constructor = function Other() {}; u.then = (resolve: (x: unknown) => void) => resolve(n); }
let stored: Promise<number> | undefined;
function again(n: number): Promise<number> { if (!stored) { stored = num(n); patch(stored, n * 100); } return stored; }
async function main(): Promise<void> { await atOnce(); await caught(); await inHand(); }
main();
export {};
