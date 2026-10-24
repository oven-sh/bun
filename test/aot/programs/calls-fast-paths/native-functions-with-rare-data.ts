// Native functions whose `name`, `length` or other properties were inspected before they are called.
declare const console: any;
const x: any = JSON.parse('{"k":"key","n":3}'); x.m = new Map([["key", 1]]); x.s = new Set(["key"]); x.a = [3, 1, 2];
const looked: any[] = [Map.prototype.set, Map.prototype.get, Set.prototype.has, Array.prototype.indexOf, Math.max, String.prototype.charCodeAt, Object.prototype.hasOwnProperty];
function state(f: any): string { return Object.getOwnPropertyNames(f).join(",") }
function all(label: string): void {
  const byValue: any = x.m.get, max: any = Math.max, has: any = x.s.has;
  console.log(label, x.m.get(x.k), x.m.set(x.k, 5) === x.m, x.m.get(x.k), x.s.has(x.k), x.s.has(1), x.a.indexOf(2), x.a.indexOf(), max(1, x.n, 2), max(), "ab".charCodeAt(1), x.hasOwnProperty("k"), x.hasOwnProperty("z"));
  console.log(label, byValue.call(x.m, x.k), byValue.apply(x.m, [x.k, 1, 2]), byValue.bind(x.m)(x.k), byValue.bind(x.m, x.k)(), has.call(x.s, "key"), [[1, 2], [3, 0]].map(p => max.apply(null, p)).join(), x.a.map(Math.max).join());
  for (const bad of [undefined, 5, {}, x.s]) { try { console.log(label, byValue.call(bad, x.k)); } catch (e) { console.log(label, (e as Error).name, String((e as Error).stack).split("\n").length > 1); } }
  try { byValue(x.k); } catch (e) { console.log(label, "without this:", (e as Error).name); }
  x.m.set(x.k, 1);
}
all("fresh");
for (const f of looked) console.log(state(f));
all("reified");
delete (Map.prototype.get as any).name; Object.defineProperty(Set.prototype.has, "name", { value: "other", configurable: true }); (Math.max as any).extra9 = 1;
console.log(Map.prototype.get.name === "", Set.prototype.has.name, state(Math.max));
all("altered");
let sum = 0; for (let i = 0; i < 2000; i++) { x.m.set(x.k, i); sum += x.m.get(x.k) + (x.s.has(x.k) ? 1 : 0) + x.a.indexOf(i & 3) + Math.max(i, x.n); } console.log("sum", sum);
