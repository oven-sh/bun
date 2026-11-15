// Awaited objects of classes that declare `then`, inherit it, hide it, lose it and get it: every look at `then` and every call of it is printed.
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (v === null || typeof v !== "object" ? typeof v + ":" + String(v) : v.constructor ? v.constructor.name : "bare");
class Query { constructor(readonly k: number) {} where(n: number) { return new Query(this.k + n); } then(ok: (v: any) => any, no?: (e: any) => any): any { log("then " + this.k); return Promise.resolve(this.k).then(ok, no); } }
class Below extends Query { limit() { return this; } }
class Getter { constructor(readonly k: number) {} get then(): any { log("get then " + this.k); return this.k === 2 ? undefined : this.k === 3 ? 5 : (f: any) => f("g" + this.k); } }
class Hides extends Query { override then: any = undefined; }
class Without { constructor(readonly k: number) {} also() { return 1; } }
class Late { constructor(readonly k: number) {} one() { return 1; } two() { return 2; } then(ok: any): any { log("late " + this.k); queueMicrotask(() => ok("l" + this.k)); } }
class Throws { constructor(readonly k: number) {} then(_: any, no: any): any { if (this.k & 1) throw new Error("t" + this.k); no(new Error("n" + this.k)); } }
const makers: ((k: number) => any)[] = [k => new Query(k), k => new Query(k).where(1), k => new Below(k).limit(), k => new Getter(k), k => new Hides(k), k => new Without(k), k => new Late(k), k => new Throws(k), k => Object.create(new Query(k)), k => Object.assign(new Without(k), { then: undefined })];
async function awaits(m: number): Promise<string> { let s = ""; for (let i = 0; i < 4; i++) { try { s += show(await makers[m](i)); } catch (e: any) { s += "!" + e.message; } } return s; }
async function returns(m: number, i: number): Promise<any> { return makers[m](i); }
async function queries(n: number): Promise<number> { let s = 0; for (let i = 0; i < n; i++) s += (await (new Query(i).where(i) as any)) as number; return s; }
async function without(n: number): Promise<string> { let s = ""; for (let i = 0; i < n; i++) s += show(await new Without(i)); return s; }
async function lates(n: number): Promise<string> { let s = ""; for (let i = 0; i < n; i++) s += show(await (new Late(i) as any)); return s; }
async function ticks(name: string, m: number): Promise<void> { for (let i = 0; i < m; i++) { log(name + i); await null; } }
async function all(word: string) {
  for (let m = 0; m < makers.length; m++) {
    log(`-- ${word} ${m}`);
    log(await awaits(m));
    for (let i = 0; i < 4; i++) try { log(show(await returns(m, i))); } catch (e: any) { log("threw " + e.message); }
    const r = await Promise.allSettled([makers[m](1), ticks("t", 4), returns(m, 1), Promise.resolve(makers[m](3))]);
    log(r.map(s => s.status[0] + show((s as any).value)).join());
    log(await Promise.race([makers[m](1), new Promise(f => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => f("race")))))]).then(show, e => "e" + e.message));
  }
  log(await queries(5)); log(await without(3)); log(await lates(3));
}
await all("first"); await all("second");
(Without.prototype as any).then = function (f: any) { log("new then"); f("new"); };
await all("gets");
delete (Query.prototype as any).then; delete (Without.prototype as any).then;
await all("loses");
(Query.prototype as any).then = function (f: any) { log("again"); f("again" + this.k); };
Object.defineProperty(Late.prototype, "then", { get() { log("late getter"); return undefined; }, configurable: true });
await all("again");
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 11 === 0 || i < 60).join("\n"));
