// Loops that tell the few names of an object's fields apart, read under keys in front of loops, and take the answers of methods that go by keys.
// STATISTIC: AccessesDispatchedByKeyString >= 4
const list: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => (i * 37) % 101).join() + "]");
const hard = JSON.parse('{"k":"k","j":"j","other":"other","number":3}');
enum Name { Count = "count", Size = "size" }
function report(name: string, body: () => unknown): void {
  try { console.log(name, JSON.stringify(body())); } catch (error) { console.log(name, (error as Error).name); }
}
class Field { constructor(public name: string) {} get(o: any): any { return o[this.name]; } set(o: any, v: any): void { o[this.name] = v; } }
let K = "k"; if (hard.number === 4) K = "j";
export function change(key: string): void { K = key; }
function record(keys: Name[], bound: number): unknown {
  const o: Record<Name, number> = { [Name.Count]: 0, [Name.Size]: 2 }; let s = 0;
  for (let r = 0; r < 3; r++) for (let i = 0; i < 64; i++) { const x = list[i]!; const k = keys[i & 3]!; o[k] = (o[k] + x) & bound; s = (s + o[k]) | 0; }
  return [s, o];
}
report("record", () => record([Name.Count, Name.Size, Name.Count, Name.Count], 1023));
report("record of other names", () => record(["other", Name.Size, Name.Count, hard.k] as any, 1023));
report("record of nothing", () => record([undefined, null, Name.Count, 3] as any, 7));
report("record of objects", () => record([{ toString() { return "size"; } }, Name.Count, Symbol.iterator, "constructor"] as any, 15));
function texts(keys: string[]): unknown {
  const o = { first: "a", second: 1.5, third: 0 }; let s = 0;
  for (let i = 0; i < 64; i++) { const k = keys[i % 5]! as "third"; o[k] += list[i]!; s += String(o[k]).length; }
  return [s, o];
}
report("texts", () => texts(["first", "second", "third", "third", "second"]));
report("texts missing", () => texts(["third", "absent", "second", "first", "third"]));
const counters = { k: 0, j: 1 };
function module0(): unknown { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < 64; i++) { const x = list[i]!; counters[K as "k"] = (counters[K as "k"] + x) & 1023; s = (s + x) | 0; } return [s, counters]; }
function module1(): unknown { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < 64; i++) { const x = list[i]!; s = (s + (counters as any)[K] + x) | 0; } return [s, counters]; }
function module2(): unknown { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < 64; i++) { const x = list[i]!; s = (s + (counters as any)[K] + x) | 0; if (i === 40) change(r & 1 ? "k" : "j"); } return [s, counters]; }
report("variable", module0); report("variable read", module1); change("j"); report("other variable", module0); report("other variable read", module1); report("variable changed", module2);
change("none"); report("missing variable", module0); report("missing variable read", module1);
const holders: [string, () => any][] = [["literal", () => ({ k: 0, j: 1 })], ["doubles", () => ({ k: 0.5, j: 1 })], ["json", () => JSON.parse('{"k":1,"j":2}')], ["above", () => Object.create({ k: 7 })], ["accessor", () => ({ get k() { return 9; }, set k(v) { hard.number = v; }, j: 1 })], ["frozen", () => Object.freeze({ k: 1, j: 2 })], ["array", () => [1, 2]], ["named", () => new Field("z")], ["proxy", () => new Proxy({ k: 4 }, { get: (t: any, p) => (p === "k" ? 5 : t[p]) })], ["global", () => globalThis], ["null", () => null], ["text", () => "abc"]];
function fields(o: any, field: Field): unknown { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < 64; i++) { const x = list[i]!; field.set(o, x); s = (s + field.get(o)) | 0; } return s; }
function reads(o: any, key: string): unknown { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < 64; i++) { s += o[key] + list[i]!; } return s; }
function alias(field: Field): unknown { const o: any = field; let s = 0; for (let i = 0; i < 64; i++) { field.set(o, i === 20 ? "name" : list[i]!); s += typeof field.get(o) === "number" ? 1 : 2; } return [s, field]; }
for (const [name, make] of holders) {
  report("field " + name, () => fields(make(), new Field(hard.k)));
  report("read " + name, () => reads(make(), hard.k));
  report("read missing " + name, () => reads(make(), hard.other));
  delete (globalThis as any).k;
}
report("alias", () => alias(new Field("name"))); report("alias of another", () => alias(new Field("k")));
