// A walk over a Map or a Set takes one step at a time. The steps see tables with short and with wide keys and values, tables out of the program's text,
// tables that grow, shrink, are cleared or are replaced under the walk, and tables too large for the short form.
function given<T>(text: string): T { return JSON.parse(text) as T; }
const lines: string[] = [];
function note(label: string, ...parts: unknown[]) { lines.push(label + ": " + parts.map(part => typeof part === "string" ? part : JSON.stringify(part)).join(" ")); }
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}
function walkMap<K, V>(map: Map<K, V>): string { let out = ""; for (const [key, value] of map) out += show(key) + "=" + show(value) + ";"; return out; }
function walkKeys<K, V>(map: Map<K, V>): string { let out = ""; for (const key of map.keys()) out += show(key) + ";"; return out; }
function walkValues<K, V>(map: Map<K, V>): string { let out = ""; for (const value of map.values()) out += show(value) + ";"; return out; }
function walkSet<T>(set: Set<T>): string { let out = ""; for (const value of set) out += show(value) + ";"; return out; }
function walkAll<K, V>(label: string, map: Map<K, V>) { note(label, walkMap(map), "|", walkKeys(map), "|", walkValues(map), "|", map.size, [...map].length, Array.from(map.keys()).length); }

// Keys and values of every kind.
const object = { a: 1 }, other = { b: 2 }, symbol = Symbol("s");
const kinds: unknown[] = ["", "a", "key", given<string>('"made"'), 0, 1, -1, 7, 2 ** 31 - 1, -(2 ** 31), 2 ** 31, 2 ** 32, 2 ** 53, 0.5, -0.5, 1e300, NaN, Infinity, -Infinity, true, false, null, undefined, object, other, symbol, 12n, [1], () => 1];
walkAll("every kind as key", new Map(kinds.map((kind, index) => [kind, index])));
walkAll("every kind as value", new Map(kinds.map((kind, index) => [index, kind])));
walkAll("every kind as both", new Map(kinds.map((kind, index) => [kind, kinds[kinds.length - 1 - index]])));
note("every kind in a set", walkSet(new Set(kinds)), new Set(kinds).size);
note("-0 is filed as 0", walkSet(new Set([-0])), walkMap(new Map([[-0, -0]])));

// One kind at a time, so that a table keeps its short form, and then one key or value that does not fit it.
const strings = new Map<string, string>(); for (let i = 0; i < 9; i++) strings.set("k" + i, "v" + i);
walkAll("strings", strings);
const small = new Map<number, number>(); for (let i = 0; i < 9; i++) small.set(i, i * i);
walkAll("small numbers", small);
small.set(0.25, 1); walkAll("then a fraction as key", small);
small.set(3, 2.5); walkAll("then a fraction as value", small);
const fractions = new Set<number>(); for (let i = 1; i < 8; i++) fractions.add(i / 8);
note("fractions", walkSet(fractions));
const objects = new Set<object>([object, other, object]); note("objects", walkSet(objects));

// Out of the program's text.
const words = new Set(["alpha", "beta", "gamma", "delta"]);
const table = new Map([["one", 1], ["two", 2], ["three", 3]]);
note("a set in the text", walkSet(words)); walkAll("a map in the text", table);
words.add("epsilon"); table.set("four", 4); table.delete("two");
note("after a change", walkSet(words)); walkAll("after a change", table);

// Empty, and filled later.
const late = new Map<string, number>(); walkAll("empty", late); note("empty set", walkSet(new Set()));
late.set("x", 1); walkAll("no longer empty", late);
{
  const filledUnderWalk = new Set<number>(); const walk = filledUnderWalk.values();
  filledUnderWalk.add(1); filledUnderWalk.add(2);
  note("a walk begun on an empty set", show(walk.next().value), show(walk.next().value), walk.next().done);
}

// Changes under the walk.
function changing(label: string, size: number, change: (map: Map<number, string>, key: number, step: number) => void) {
  const map = new Map<number, string>(); for (let i = 0; i < size; i++) map.set(i, "v" + i);
  let seen = "", step = 0;
  for (const [key, value] of map) { seen += key + value + ";"; change(map, key, step++); if (step > 200) break; }
  note(label, seen, "|", walkMap(map));
}
changing("deletes what it stands on", 6, (map, key) => map.delete(key));
changing("deletes what comes next", 6, (map, key) => map.delete(key + 1));
changing("deletes what lies behind", 6, (map, key) => map.delete(key - 1));
changing("deletes and adds again", 4, (map, key, step) => { if (step < 4) { map.delete(key); map.set(key, "again"); } });
changing("adds until the table grows", 3, (map, key, step) => { if (step < 40) map.set(100 + step, "new"); });
changing("clears at the third", 6, (map, key, step) => { if (step === 2) map.clear(); });
changing("clears and fills again", 6, (map, key, step) => { if (step === 2) { map.clear(); map.set(50, "a"); map.set(51, "b"); } });
changing("turns the keys wide", 5, (map, key, step) => { if (step === 1) map.set(0.5, "half"); });
changing("deletes all but the last", 8, (map, key, step) => { if (!step) for (let i = 1; i < 7; i++) map.delete(i); });
{
  const set = new Set([1, 2, 3, 4, 5, 6]); let seen = "";
  for (const value of set) { seen += value + ";"; if (value % 2) set.delete(value + 1); if (value === 5) set.add(9); }
  note("a set that changes", seen, "|", walkSet(set));
}

// Two walks over one table, a walk left early, a walk inside a walk.
{
  const map = new Map([["a", 1], ["b", 2], ["c", 3]]); let out = "";
  for (const [outer] of map) for (const [inner, value] of map) { if (inner === "c" && outer === "a") break; out += outer + inner + value + ";"; }
  note("a walk in a walk", out);
  const first = map.entries(), second = map.entries(); first.next();
  note("two walks", first.next().value, second.next().value, first.next().value, first.next().done, second.next().value);
}

// Many entries, with holes.
function large(size: number) {
  const map = new Map<number, number>(), set = new Set<string>();
  for (let i = 0; i < size; i++) { map.set(i, i * 3); set.add("s" + i); }
  for (let i = 0; i < size; i += 3) { map.delete(i); set.delete("s" + i); }
  let keys = 0, values = 0, characters = 0, steps = 0;
  for (const [key, value] of map) { keys += key; values += value; steps++; }
  for (const value of set) characters += value.length;
  note("large " + size, keys, values, characters, steps, map.size, set.size);
}
for (const size of [1, 4, 5, 8, 9, 16, 17, 100, 254, 255, 256, 1000, 70000]) large(size);

// What built-ins make, and heirs.
walkAll("grouped", Map.groupBy([1, 2, 3, 4, 5], value => value % 2 ? "odd" : "even") as Map<string, unknown>);
note("a union", walkSet(new Set([1, 2]).union(new Set([2, 3]))));
class Counted<K, V> extends Map<K, V> { sets = 0; set(key: K, value: V) { this.sets++; return super.set(key, value); } }
const counted = new Counted<string, number>([["p", 1], ["q", 2]]); walkAll("an heir", counted); note("its own count", counted.sets);
walkAll("a copy", new Map(counted)); note("a copy of a set", walkSet(new Set(words)));

// The collector runs between the steps.
{
  const map = new Map<object, string[]>(); for (let i = 0; i < 300; i++) map.set({ i }, ["x" + i]);
  let sum = 0, step = 0;
  for (const [key, value] of map) { if (step++ % 50 === 0) Bun.gc(true); sum += (key as { i: number }).i + value[0].length; }
  note("with collections", sum);
}
console.log(lines.join("\n"));
