// A round through the language: async generators. It prints what plain Bun prints.
type P = { x: number };
async function show(label: string, f: () => unknown) {
  try { console.log(label, String(await f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
async function plain(p: P, n: number): Promise<number> { return p.x + n; }
async function waits(p: P, n: number): Promise<number> { await null; return p.x + n; }
async function awaitsTyped(v: Promise<number>): Promise<number> { const n = await v; return n + 1; }
async function returnsAny(v: any): Promise<number> { return v; }
async function usesResult(v: any): Promise<string> { const n: number = await returnsAny(v); return "r" + (n + 1); }
async function usesPlain(v: any, w: any): Promise<string> { const n = await (plain as any)(v, w); return "p" + n; }
function* gen(a: number, p: P): Generator<number, string, number> { const got = yield a + p.x; const more = yield got * 2; return "end" + (more + 1); }
async function* agen(a: number): AsyncGenerator<number, void, string> { const s = yield a + 1; yield s.length; }
const A: any = { plain, waits, awaitsTyped, gen, agen };
await show("plain", () => plain({ x: 1 }, 2));
await show("plain-bad", () => A.plain("s", {}));
await show("plain-bad2", () => A.plain({ x: "a" }, "b"));
await show("plain-bad3", () => A.plain(null, 1));
await show("waits-bad", () => A.waits({ x: [] }, {}));
await show("waits-bad2", () => A.waits(undefined, 1));
await show("awaitsTyped", () => awaitsTyped(Promise.resolve(1)));
await show("awaitsTyped-bad", () => A.awaitsTyped(Promise.resolve("s")));
await show("awaitsTyped-bad2", () => A.awaitsTyped("not a promise"));
await show("awaitsTyped-bad3", () => A.awaitsTyped({ then(r: any) { r({ valueOf: () => 4 }); } }));
await show("usesResult", () => usesResult(1));
await show("usesResult-bad", () => usesResult("one"));
await show("usesResult-bad2", () => usesResult(Promise.resolve({})));
await show("usesResult-bad3", () => usesResult({ then(r: any) { r("thenable"); } }));
await show("usesPlain", () => usesPlain({ x: 1 }, 2));
await show("usesPlain-bad", () => usesPlain({ x: "q" }, null));
await show("gen", () => { const g = gen(1, { x: 2 }); return [g.next().value, g.next(3).value, g.next(4).value]; });
await show("gen-bad", () => { const g = A.gen("1", { x: "2" }); return [g.next().value, g.next("3").value, g.next({}).value]; });
await show("gen-bad2", () => { const g = A.gen(1, null); return g.next().value; });
await show("gen-next-bad", () => { const g: any = gen(1, { x: 2 }); return [g.next("ignored").value, g.next("x").value, g.next([9]).value]; });
await show("agen", async () => { const g = agen(1); return [(await g.next()).value, (await g.next("abc")).value]; });
await show("agen-bad", async () => { const g = A.agen("z"); return [(await g.next()).value, (await g.next(55)).value]; });
await show("agen-bad2", async () => { const g = A.agen({}); return [(await g.next()).value, (await g.next(null)).value]; });
await show("all", () => Promise.all([A.plain({ x: 1 }, 1), A.plain({ x: "1" }, 1), A.waits({ x: 1 }, "1")]));
for (const v of [1, "2", { x: 3 }, null]) await show("loop", () => A.waits({ x: v }, v));
