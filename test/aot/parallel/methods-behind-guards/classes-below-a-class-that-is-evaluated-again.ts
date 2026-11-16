// A class that is evaluated once may stand below one that is evaluated again and again: each evaluation has a prototype object of its own, and what is laid on any of them is found from below.
let log = "";
const sink: unknown[] = []; (globalThis as any).sinkOfAgain = sink;
function escape<T>(o: T): T { sink.push(o); sink.length = 0; return o; }
function attempt(run: () => unknown): string { log = ""; try { return String(run()) + "[" + log + "]"; } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + "[" + log + "]"; } }
function parent(tag: string) { return class Parent { m(): string { return "Parent.m"; } tagged(): string { return tag; } }; }
const First = parent("first"), Second = parent("second"), Third = parent("third");
class BelowFirst extends First { declare limit?: number; name = "f"; own(): string { return "own"; } }
class BelowSecond extends Second { declare limit?: number; name = "s"; own(): string { return "own"; } }
class BelowThird extends Third { declare limit?: number; name = "t"; own(): string { return "own"; } }
function callsFirst(o: BelowFirst): string { return o.m() + o.tagged() + o.own(); }
function callsSecond(o: BelowSecond): string { return o.m() + o.tagged() + o.own(); }
function callsThird(o: BelowThird): string { return o.m() + o.tagged() + o.own(); }
function readsFirst(o: BelowFirst): string { let s = ""; for (let i = 0; i < 2; i++) s += o.limit + ","; return s; }
function readsSecond(o: BelowSecond): string { let s = ""; for (let i = 0; i < 2; i++) s += o.limit + ","; return s; }
function readsThird(o: BelowThird): string { let s = ""; for (let i = 0; i < 2; i++) s += o.limit + ","; return s; }
function storesFirst(o: BelowFirst): string { o.limit = 1; return Object.keys(o).join() + o.limit; }
function storesSecond(o: BelowSecond): string { o.limit = 1; return Object.keys(o).join() + o.limit; }
function storesThird(o: BelowThird): string { o.limit = 1; return Object.keys(o).join() + o.limit; }
function all(): string {
  return [attempt(() => callsFirst(escape(new BelowFirst()))), attempt(() => callsSecond(escape(new BelowSecond()))), attempt(() => callsThird(escape(new BelowThird()))),
    attempt(() => readsFirst(escape(new BelowFirst()))), attempt(() => readsSecond(escape(new BelowSecond()))), attempt(() => readsThird(escape(new BelowThird()))),
    attempt(() => storesFirst(escape(new BelowFirst()))), attempt(() => storesSecond(escape(new BelowSecond()))), attempt(() => storesThird(escape(new BelowThird())))].join(" ");
}
console.log(all());
for (const [who, holder] of [["first", First.prototype], ["second", Second.prototype], ["third", Third.prototype]] as [string, any][]) {
  holder.m = () => "replaced on " + who;
  console.log(who, "m", all());
  Object.defineProperty(holder, "limit", { get() { log += "g"; return 7; }, set(v: unknown) { log += "s"; }, configurable: true });
  console.log(who, "limit", all());
  Object.defineProperty(holder, "own", { value: () => "never found", configurable: true });
  holder.tagged = () => "tag of " + who;
  console.log(who, "tagged", all());
}
