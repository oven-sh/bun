// A question asked in a small callee that answers `? true : false` (or returns true here and false there), and a caller that branches on the answer: the ways of yes and no go on apart behind the
// copy, and what the callee has proven of what it was handed holds on the way of its yes. Every form is asked with things that pass, that fail, and that change between the question and the use.
type Any = any;
class Point { constructor(public a: number, public b: number) {} }
class Heir extends Point { more = 1; }
class Other { constructor(public c: number) {} }
const log: string[] = [];
function isPoint(p: unknown) { return p instanceof Point ? true : false; }
function isNoPoint(p: unknown) { return p instanceof Point ? false : true; }
function below(i: number, n: number) { return i < n ? true : false; }
function isText(x: unknown) { return typeof x === "string" ? true : false; }
function both(p: unknown, i: number) { return isPoint(p) && below(i, 3) ? true : false; }
function byTry(p: Any) { try { return p.a > 0 ? true : false; } catch { return false; } }
function withDeeds(p: unknown) { if (p instanceof Point) { log.push("deed yes"); return true; } log.push("deed no"); return false; }
function ofThree(p: unknown) { if (p instanceof Point) return true; if (p instanceof Other) return false; return p ? true : false; }
function yesOrThing(p: Any) { return p instanceof Point ? true : p; }
function sum(p: Any) { if (isPoint(p)) return p.a + p.b; return -1; }
function sumOfOthers(p: Any) { if (isNoPoint(p)) return "none"; return p.a * p.b; }
function negated(p: Any) { if (!isPoint(p)) return "not"; return p.b - p.a; }
function kept(p: Any) { const answer = isPoint(p); const said = answer ? p.a : "-"; return said + ":" + answer; }
function inExpression(p: Any, i: number) { return (isPoint(p) ? p.a : 100) + (below(i, 2) ? 1 : 2); }
function pick(list: number[], i: number) { if (below(i, list.length)) return list[i]; return -1; }
function size(x: Any) { if (isText(x)) return x.length; return -2; }
function inLoop(list: Any[]) { let total = 0; for (let i = 0; below(i, list.length); i++) { if (isPoint(list[i])) total += list[i].a; else total -= 1; } return total; }
function changedBetween(p: Any, change: (p: Any) => void) { if (isPoint(p)) { change(p); return String(p.a) + "," + String(p.b); } return "no point"; }
function twice(p: Any) { if (isPoint(p)) { if (isPoint(p)) return p.a; return "lost"; } return isPoint(p) ? "found late" : "never"; }
const things: [string, () => Any][] = [
  ["a point", () => new Point(1, 2)], ["an heir", () => new Heir(3, 4)], ["another", () => new Other(5)], ["a literal", () => ({ a: 6, b: 7 })], ["null", () => null], ["undefined", () => undefined],
  ["a number", () => 8], ["a text", () => "text"], ["zero", () => 0], ["a point without a", () => { const p: Any = new Point(9, 10); delete p.a; return p; }],
  ["a point with an accessor", () => Object.defineProperty(new Point(11, 12), "a", { get() { return 110; }, configurable: true })],
  ["a thing laid under Point", () => Object.create(Point.prototype)], ["a proxy of a point", () => new Proxy(new Point(13, 14), {})], ["a frozen point", () => Object.freeze(new Point(15, 16))],
];
const changes: [string, (p: Any) => void][] = [
  ["nothing", () => {}], ["a store", p => { p.a = "stored"; }], ["a delete", p => { delete p.b; }], ["an accessor", p => { Object.defineProperty(p, "a", { get() { return "got"; }, configurable: true }); }],
  ["another prototype", p => { Object.setPrototypeOf(p, { b: "above" }); delete p.b; }], ["a new name", p => { p.z = 1; }],
];
const askers: [string, (p: Any) => unknown][] = [
  ["sum", sum], ["sumOfOthers", sumOfOthers], ["negated", negated], ["kept", kept], ["inExpression", p => inExpression(p, 1) + "|" + inExpression(p, 5)], ["size", size], ["twice", twice],
  ["both", p => both(p, 1) + "," + both(p, 7)], ["byTry", byTry], ["withDeeds", p => (withDeeds(p) ? "Y" + p.a : "N")], ["ofThree", p => (ofThree(p) ? "three yes" : "three no")],
  ["yesOrThing", p => { const said = yesOrThing(p); return said === true ? "true " + p.b : typeof said; }],
];
for (const [name, ask] of askers) {
  for (const [what, make] of things) {
    let said = "";
    for (let turn = 0; turn < 8; turn++) {
      let now: string;
      try { now = String(ask(make())); } catch (error) { now = "threw " + (error as Error).constructor.name; }
      if (!said.endsWith(now)) said += (said ? " THEN " : "") + now;
    }
    log.push(name + " . " + what + ": " + said);
  }
}
for (const [how, change] of changes) for (const [what, make] of things) {
  let now: string;
  try { now = changedBetween(make(), change); } catch (error) { now = "threw " + (error as Error).constructor.name; }
  log.push("changed by " + how + " . " + what + ": " + now);
}
log.push("pick: " + [-1, 0, 1, 2, 3, 1.5, NaN].map(i => pick([10, 20, 30], i)).join());
log.push("in a loop: " + inLoop(things.map(([, make]) => make())));
console.log(log.join("\n"));
