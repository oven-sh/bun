// for await over objects of the program whose methods are replaced: which methods run, what they answer, what is awaited and what is closed, beside jobs of others and while methods are replaced.
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (v === null || typeof v !== "object" ? typeof v + ":" + String(v) : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v.constructor ? v.constructor.name + JSON.stringify(v) : "bare");
async function soon(v: any): Promise<any> { await null; return v; }
class Answer { constructor(public done: boolean, public value: any) {} }
class Known { at = 0; constructor(public n: number) {} [Symbol.asyncIterator]() { return this; } async next() { await null; return { done: this.at++ >= this.n, value: this.at }; } }
class AtOnce { at = 0; constructor(public n: number) {} [Symbol.asyncIterator]() { return this; } async next() { return { done: this.at++ >= this.n, value: this.at * 0.5 }; } }
class Sometimes { at = 0; constructor(public n: number) {} [Symbol.asyncIterator]() { return this; } async next(): Promise<{ done: boolean; value: any }> { if (this.at & 1) await soon(1); return this.at++ < this.n ? { done: false, value: "s" + this.at } : { done: true, value: undefined }; } async return() { log("return"); return { done: true, value: 0 }; } }
class Other { at = 0; constructor(public n: number) {} [Symbol.asyncIterator]() { log("open"); return { at: 0, n: this.n, async next() { return { done: this.at++ >= this.n, value: { at: this.at } }; } }; } async next() { log("wrong next"); return { done: true, value: 0 }; } }
class Plain { at = 0; constructor(public n: number) {} [Symbol.asyncIterator]() { return this; } next(): any { const answer = { done: this.at++ >= this.n, value: this.at }; return this.at & 1 ? Promise.resolve(answer) : answer; } return(): any { log("plain return"); return Promise.resolve({}); } }
class Gives { at = 0; constructor(public n: number) {} [Symbol.asyncIterator](): any { return this; } async next(): Promise<any> { this.at++; return this.at > 3 ? new Answer(true, 0) : this.at === 2 ? soon(new Answer(false, Promise.resolve("inner"))) : new Answer(false, { then(f: any) { log("then of value"); f(7); } }); } }
class Bad { at = 0; constructor(public n: number) {} [Symbol.asyncIterator](): any { return this; } async next(): Promise<any> { this.at++; return this.n === 1 ? 5 : this.n === 2 && this.at === 2 ? null : this.n === 3 && this.at === 2 ? Promise.reject(new Error("rejected")) : this.at > 2 ? { get done() { log("done"); return true; } } : { get done() { log("done"); return 0; }, get value() { log("value"); return 1; } }; } async return(): Promise<any> { log("bad return"); return 5; } }
class Throws { at = 0; constructor(public n: number) {} [Symbol.asyncIterator](): any { if (this.n === 4) throw new Error("open"); return this.n === 3 ? 5 : this; } async next(): Promise<any> { if (this.at++ === 1) throw new Error("next"); return { done: false, value: this.at }; } async return(): Promise<any> { throw new Error("return"); } }
class Changes { at = 0; constructor(public n: number) {} [Symbol.asyncIterator](): any { return this; } async next(): Promise<any> { this.at++; if (this.n === 1) (this as any).next = async () => ({ done: true, value: "own" }); if (this.n === 2 && this.at === 1) Changes.prototype.next = async function (this: any) { log("replaced"); return { done: this.at++ > 3, value: "r" + this.at }; }; return { done: this.at > 3, value: this.at }; } }
class Below extends Known { override async next() { const answer = await super.next(); log("below"); return answer; } }
class Sync { at = 0; constructor(public n: number) {} [Symbol.iterator](): any { return { next: () => ({ done: this.at++ >= this.n, value: this.at & 1 ? soon(this.at) : this.at }), return: () => { log("sync return"); return {}; } }; } }
class Generates { constructor(public n: number) {} async *[Symbol.asyncIterator](): AsyncGenerator<any> { try { for (let i = 0; i < this.n; i++) yield i; } finally { log("generator ends"); } } }
const makers: ((n: number) => any)[] = [n => new Known(n), n => new AtOnce(n), n => new Sometimes(n), n => new Other(n), n => new Plain(n), n => new Gives(n), n => new Bad(n), n => new Throws(n), n => new Changes(n), n => new Below(n), n => new Sync(n), n => new Generates(n)];
async function ticks(name: string, m: number): Promise<void> { for (let i = 0; i < m; i++) { log(name + i); await null; } }
async function known(n: number): Promise<number> { let s = 0; for await (const v of new Known(n)) { s += v; if (v === 2) queueMicrotask(() => log("beside")); log("k" + v); } return s; }
async function atOnce(n: number): Promise<number> { let s = 0; for await (const v of new AtOnce(n)) { s += v; log("o" + v); } return s; }
async function sometimes(n: number): Promise<string> { let s = ""; for await (const v of new Sometimes(n)) { s += v; log(v); if (s.length > 5) break; } return s; }
async function other(n: number): Promise<string> { let s = ""; for await (const { at } of new Other(n)) { s += at; } return s; }
async function plain(n: number): Promise<string> { let s = ""; for await (const v of new Plain(n)) { s += v; if (v === 3) return s + "!"; } return s; }
async function gives(): Promise<string> { let s = ""; for await (const v of new Gives(1)) s += show(v); return s; }
async function bad(n: number): Promise<string> { let s = ""; for await (const v of new Bad(n)) { s += show(v); if (n === 5) break; } return s; }
async function throws(n: number): Promise<string> { let s = ""; for await (const v of new Throws(n)) { s += show(v); if (n === 1) throw new Error("body"); } return s; }
async function changes(n: number): Promise<string> { let s = ""; for await (const v of new Changes(n)) s += show(v); return s; }
async function below(n: number): Promise<number> { let s = 0; for await (const v of new Below(n)) s += v; return s; }
async function sync(n: number): Promise<string> { let s = ""; for await (const v of new Sync(n)) { s += show(v); if (n === 4) break; } return s; }
async function generates(n: number): Promise<string> { let s = ""; for await (const v of new Generates(n)) { s += v; if (v === 2) break; } return s; }
async function* delegates(n: number): AsyncGenerator<any> { const result = yield* new Sometimes(n) as any; log("gave " + show(result)); yield* new Known(2) as any; }
async function through(n: number): Promise<string> { let s = ""; for await (const v of delegates(n)) { s += show(v); if (s.length > 40) break; } return s; }
async function any(make: (n: number) => any, n: number): Promise<string> { let s = ""; for await (const v of make(n)) { s += show(v); if (s.length > 60) break; } return s; }
async function byHand(n: number): Promise<string> { const it = new Known(n)[Symbol.asyncIterator](); let s = ""; for (;;) { const r = await it.next(); if (r.done) return s; s += r.value; } }
const runs: ((n: number) => Promise<any>)[] = [known, atOnce, sometimes, other, plain, gives, bad, throws, changes, below, sync, generates, through, byHand];
async function main() {
  for (let round = 0; round < 3; round++) {
    for (let r = 0; r < runs.length; r++) for (let n = 0; n < 6; n++) { log(`-- ${r} ${n}`); try { log(show(await (n === 4 ? Promise.all([runs[r](n), ticks("t", 12)]) : runs[r](n)))); } catch (e: any) { log("threw " + e.message.slice(0, 30)); } }
    for (let m = 0; m < makers.length; m++) for (let n = 1; n < 5; n++) try { log(await any(makers[m], n)); } catch (e: any) { log("threw " + e.message.slice(0, 30)); }
    if (round === 1) { Known.prototype.next = async function (this: any) { log("new next"); return { done: this.at++ > 1, value: 9 }; } as any; (AtOnce.prototype as any)[Symbol.asyncIterator] = function (this: any) { log("new open"); return new Known(1); }; (Sometimes.prototype as any).return = undefined; }
  }
}
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 41 === 0 || i < 60).join("\n"));
