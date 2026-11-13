// Awaited calls of async members that stand under one name, while the members are replaced in front of, between and amid the calls.
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (v === null || typeof v !== "object" ? typeof v + ":" + String(v) : JSON.stringify(v));
async function soon(v: any): Promise<any> { await null; return v; }
class Files { static opened = 0; static async open(x: number): Promise<number> { await null; Files.opened++; return x + 1; } static async read(x: number): Promise<any> { log("read"); return { x }; } static async fails(x: number): Promise<number> { if (x === 2) throw new Error("two"); return x; } static async waits(x: number): Promise<string> { if (x & 1) await soon(1); return "w" + x; } }
class More extends Files { static async more(x: number): Promise<any> { return More.open(x); } }
const api = { count: 0, async get(x: number): Promise<any> { this.count++; return soon(x); }, async put(x: number): Promise<any> { await null; log("put " + x); return [x]; } };
class Store { at = 0; async load(x: number): Promise<number> { await null; return x * 2; } }
const store = new Store();
async function other(this: any, x: any): Promise<any> { log("other " + x); if (x & 1) await null; return "o" + x; }
const replacements: any[] = [other, (x: any) => "sync" + x, (x: any) => Promise.resolve("p" + x), (x: any) => ({ then(f: any) { log("then"); f("t" + x); } }), () => { throw new Error("thrown"); }, null];
async function opens(n: number): Promise<any> { let s: any = 0; for (let i = 0; i < n; i++) { s = await Files.open(i); log(show(s)); } return s; }
async function between(n: number, change: () => void): Promise<any> { let s = ""; for (let i = 0; i < n; i++) { s += show(await Files.open(i)); if (i === 1) change(); s += show(await Files.waits(i)); } return s; }
async function argument(n: number, change: () => number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) s += show(await Files.open(i === 1 ? change() : i)); return s; }
async function amid(n: number, change: () => void): Promise<any> { let s = ""; for (let i = 0; i < n; i++) { queueMicrotask(() => { if (i === 1) change(); }); s += show(await api.get(i)) + show(await api.put(i)); } return s; }
async function nested(n: number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) s += show(await Files.open(await api.get(await store.load(i)))); return s; }
async function arms(n: number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) s += show(await (i & 1 ? Files.open(i) : api.put(i))); return s; }
async function caught(n: number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) { try { s += show(await Files.fails(i)); } catch (e: any) { s += "!" + e.message; } finally { s += "f"; } } return s; }
async function switches(n: number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) switch (await Files.open(i)) { case 1: s += "one"; break; case 2: continue; default: s += "more"; } return s; }
async function destructures(n: number): Promise<any> { let s = 0; for (let i = 0; i < n; i++) { const { x = 5 } = (await Files.read(i)) ?? {}; s += x; } return s; }
async function below(n: number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) s += show(await More.open(i)) + show(await More.more(i)); return s; }
async function instance(n: number): Promise<any> { let s = 0; for (let i = 0; i < n; i++) s += await store.load(i); return s; }
async function kept(n: number): Promise<any> { let s = ""; for (let i = 0; i < n; i++) { const p = Files.open(i); log("has"); s += show(await p); } return s; }
async function* generates(n: number): AsyncGenerator<any> { for (let i = 0; i < n; i++) yield await Files.open(i); }
async function consumes(n: number): Promise<any> { let s = ""; for await (const v of generates(n)) s += show(v); return s; }
async function returns(n: number): Promise<any> { return await Files.open(n); }
const outside = async (n: number): Promise<any> => { const a = await Files.open(n); const b = await api.get(n); return [show(a), show(b)]; };
const simple = [opens, nested, arms, caught, switches, destructures, below, instance, kept, consumes, returns, outside];
async function all(word: string) {
  for (const run of simple) { log(`-- ${word} ${run.name}`); try { log(show(await run(4))); } catch (e: any) { log("threw " + e.message.slice(0, 24)); } }
}
async function main() {
  await all("first"); await all("second");
  const open = Files.open, get = api.get, load = store.load, waits = Files.waits;
  for (const replacement of replacements) {
    for (const change of [() => { (Files as any).open = replacement; }, () => { (Files as any).waits = replacement; }]) { try { log(await between(4, change)); } catch (e: any) { log("threw " + e.message.slice(0, 24)); } (Files as any).open = open; (Files as any).waits = waits; }
    try { log(await argument(4, () => { (Files as any).open = replacement; return 7; })); } catch (e: any) { log("threw " + e.message.slice(0, 24)); } (Files as any).open = open;
    try { log(await amid(4, () => { (api as any).get = replacement; })); } catch (e: any) { log("threw " + e.message.slice(0, 24)); } (api as any).get = get;
    (Files as any).open = replacement; await all("static"); (Files as any).open = open;
    (api as any).get = replacement; await all("object"); (api as any).get = get;
    (store as any).load = replacement; await all("own"); delete (store as any).load;
    (Store.prototype as any).load = replacement; await all("prototype"); (Store.prototype as any).load = load;
  }
  Object.defineProperty(Files, "open", { configurable: true, get() { log("get open"); return other; } }); await all("getter");
  Object.defineProperty(Files, "open", { configurable: true, writable: true, value: open });
  delete (More as any).more; Object.setPrototypeOf(More, { open: other }); await all("without");
}
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 31 === 0 || i < 60).join("\n"));
