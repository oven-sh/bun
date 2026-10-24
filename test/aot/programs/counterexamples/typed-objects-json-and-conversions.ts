// `toJSON`, `toPrimitive`, replacers, revivers, cycles, `==` and `typeof`.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; when?: Date; sub?: Item };
class Money { constructor(public cents: number) { } toJSON(): string { return (this.cents / 100).toFixed(2) } toString(): string { return "$" + this.toJSON() } valueOf(): number { return this.cents } [Symbol.toPrimitive](hint: string): unknown { return hint === "number" ? this.cents : this.toString() } }
row("toJSON, toString, valueOf, toPrimitive on an instance", () => { const m = new Money(150); return JSON.stringify({ m }) + " " + `${m}` + " " + (+m) + " " + (hide(m) + 1) + " " + (hide(m) > 100) });
row("stringify with a replacer, a list, an indent", () => { const t: Item = { id: 1, n: 2, sub: { id: 3, n: 4 } }; return JSON.stringify(t, (k, v) => typeof v === "number" ? v * 2 : v) + " " + JSON.stringify(t, ["id"]) + " " + JSON.stringify({ id: 1 } as Partial<Item>, null, 1).length });
row("undefined, functions, symbols are left out", () => JSON.stringify({ a: undefined, b: () => 1, c: Symbol("s"), d: null, e: NaN, f: [undefined] }));
row("a cycle", () => { const t: Item = { id: 1, n: 1 }; t.sub = t; return JSON.stringify(t) });
row("parse with a reviver into a type", () => { const t: Item = JSON.parse('{"id":1,"n":2,"when":"2020-01-01T00:00:00.000Z"}', (k, v) => k === "when" ? new Date(v) : v); return t.when!.getUTCFullYear() + " " + t.n });
row("a record to a primitive", () => { const t: Item = { id: 1, n: 1 }; return "" + hide(t) + " " + isNaN(+hide(t)) + " " + (hide(t) == "[object Object]") });
row("== between kinds", () => (hide(1) == "1") + " " + (hide(null) == undefined) + " " + (hide(0) == "") + " " + (hide([1]) == 1) + " " + (hide({}) == "[object Object]") + " " + (hide(NaN) == hide(NaN)));
row("typeof of everything", () => [undefined, null, 1, 1n, "s", Symbol(), () => 1, class { }, {}, [], new Date(), /r/].map(v => typeof v).join());
row("Date, RegExp, Error through types", () => { const d: Date = new Date(0); const r: RegExp = /a(b)?/g; const e: Error = new TypeError("m", { cause: 5 }); return d.toISOString() + " " + "ab a".replace(r, "x") + " " + r.lastIndex + " " + e.name + " " + e.cause + " " + Object.keys(e).join() });
