// Native getters such as RegExp's legacy static properties are read by name through a receiver of unknown type, and are really called at every read.
declare const console: any; declare const globalThis: any; declare const Bun: any;
const said: string[] = [];
function block(name: string, body: () => unknown) { try { said.push(name + ": " + body()); } catch (e: any) { said.push(name + ": THROWS " + e?.constructor?.name); } }
function hide(x: unknown): any { return [x, 0][said.length < 0 ? 1 : 0]; }
function collect() { (globalThis.gc ?? Bun.gc)(true); }
function lastMatch(r: any): unknown { return r.lastMatch; }
function first(r: any): unknown { return r.$1; }
function input(r: any): unknown { return r.input; }
function left(r: any): unknown { return r.leftContext; }
class Sub extends RegExp {}
class SubSub extends Sub {}
const R = hide(RegExp), S = hide(Sub), T = hide(SubSub);
block("what it yields changes between reads at one site", () => { const out: unknown[] = []; for (let i = 0; i < 40; i++) { /(\d+)-/.exec("a" + i + "-b"); if (i % 13 === 0 || i > 37) out.push(lastMatch(R) + "|" + first(R) + "|" + input(R) + "|" + left(R)); else { lastMatch(R); first(R); input(R); left(R); } } return out.join(" "); });
block("inherited: a subclass's constructor, and one more up", () => { const out: unknown[] = []; for (let i = 0; i < 30; i++) { /x(.)/.exec("wx" + (i % 10)); const a = lastMatch(S), b = first(T); if (i > 27) out.push(a + "|" + b); } return out.join(" "); });
block("three receivers in turn at one site", () => { let n = 0; const all = [R, S, T]; for (let i = 0; i < 90; i++) { /q(.)/.exec("q" + (i % 7)); if (first(all[i % 3]) === String(i % 7)) n++; } return n; });
block("after collections", () => { let n = 0; for (let i = 0; i < 12; i++) { /z(.)/.exec("z" + i % 10); if (i % 4 === 0) collect(); if (first(R) === String(i % 10) && lastMatch(S) === "z" + i % 10) n++; } return n; });
block("what it yields is called: o.m() where m is a custom getter", () => { const out: unknown[] = []; for (let i = 0; i < 20; i++) { /k/.exec("k"); try { out.push(R.lastMatch()); } catch (e: any) { if (i > 17) out.push(e.constructor.name); } } return out.join(" "); });
block("what is no object, at a site that has learnt", () => [lastMatch(hide(5)), lastMatch(hide("s")), lastMatch(hide({})), lastMatch(hide(() => 1)), lastMatch(hide({ lastMatch: "own" }))].join(","));
block("nil at that site", () => lastMatch(hide(undefined)));
block("shadowed on the subclass", () => { /m/.exec("m"); const before = lastMatch(S); Object.defineProperty(Sub, "lastMatch", { value: "shadow", configurable: true }); const during = lastMatch(S) + "|" + lastMatch(T) + "|" + lastMatch(R); delete (Sub as any).lastMatch; return before + " " + during + " " + lastMatch(S); });
block("the chain cut", () => { /n/.exec("n"); const before = lastMatch(T); Object.setPrototypeOf(SubSub, Function.prototype); const during = lastMatch(T); Object.setPrototypeOf(SubSub, Sub); return before + " " + during + " " + lastMatch(T); });
block("redefined on RegExp itself, then deleted", () => { /p/.exec("p"); const before = lastMatch(R) + "|" + lastMatch(S); Object.defineProperty(RegExp, "lastMatch", { value: "redefined", configurable: true }); const during = lastMatch(R) + "|" + lastMatch(S); delete (RegExp as any).lastMatch; return before + " " + during + " " + lastMatch(R) + "|" + lastMatch(S) + " " + first(R); });
console.log(said.join("\n"));
export {};
