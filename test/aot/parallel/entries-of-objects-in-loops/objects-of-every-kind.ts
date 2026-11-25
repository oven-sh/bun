// STATISTIC: OwnKeyWalksExpanded >= 1
const said: string[] = [];
class P { x = 1; y = "two"; z: number | undefined = undefined; }
class Q extends P { w = 4; get v() { said.push("v is read"); return 5; } }
function show(o: unknown): string { try { return JSON.stringify(Object.entries(o as object)); } catch (e) { return (e as Error).name; } }
function plain(p: P): string { return JSON.stringify(Object.entries(p)); }
const grown = new P(); (grown as any).extra = 9;
const shrunk = new P(); delete (shrunk as any).y;
const again = new P(); delete (again as any).x; again.x = 7;
const hidden = new P(); Object.defineProperty(hidden, "y", { enumerable: false });
const getter = new P(); Object.defineProperty(getter, "x", { get() { said.push("x is read"); (getter as any).z = "late"; return 11; }, enumerable: true, configurable: true });
const marked = new P(); (marked as any)[Symbol("s")] = 1; (marked as any)[3] = "three"; (marked as any)[1] = "one";
const frozen = Object.freeze(new P());
const others: unknown[] = [new P(), new Q(), grown, shrunk, again, hidden, getter, marked, frozen, Object.create(new P()), { y: 1, x: 2 }, {}, [7, 8], "ab", 5, true, null, undefined, new Proxy(new P(), { ownKeys() { said.push("keys are asked"); return ["y"]; } }), Object.assign(Object.create(null), { a: 1 }), function f() {}, new Map([[1, 2]])];
for (let turn = 0; turn < 60; turn++) {
  said.length = 0;
  for (const o of others) said.push(show(o));
  for (const o of [new P(), grown, shrunk, again, hidden, marked, frozen]) said.push(plain(o));
}
console.log(said.join("\n"));
