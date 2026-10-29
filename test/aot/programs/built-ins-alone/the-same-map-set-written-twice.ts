// `map.set(key, value)` written twice in a row, as TypeScript's addInheritedMembers has it, and everything that looks like it and is not it.
const lines: string[] = [];
const show = (m: Map<unknown, unknown>) => [...m].map(([k, v]) => String(k) + "=" + String(v)).join(",");
type Named = { name: string; rank: number };
function twice(table: Map<string, Named>, items: Named[]) { for (const item of items) { table.set(item.name, item); table.set(item.name, item); } return table.size; }
function otherValue(table: Map<string, number>, key: string) { table.set(key, 1); table.set(key, 2); }
function otherKey(table: Map<string, number>, a: string, b: string) { table.set(a, 1); table.set(b, 1); }
function otherMap(first: Map<string, number>, second: Map<string, number>, key: string) { first.set(key, 1); second.set(key, 1); }
function deletedBetween(table: Map<string, number>, key: string) { table.set("first", 0); table.set(key, 1); table.set("last", 2); table.set(key, 1); table.delete(key); table.set(key, 1); table.set(key, 1); }
function clearedBetween(table: Map<string, number>, key: string) { table.set(key, 1); table.clear(); table.set(key, 1); }
function codeBetween(table: Map<string, number>, key: string, run: () => void) { table.set(key, 1); run(); table.set(key, 1); }
function chained(table: Map<string, number>, key: string) { return table.set(key, 1).set(key, 1).set(key, 1) === table; }
function keyReadTwice(table: Map<string, Named>, item: Named, change: boolean) { table.set(item.name, item); if (change) item.name = "changed"; table.set(item.name, item); }
function oddKeys(table: Map<unknown, unknown>) { table.set(NaN, 1); table.set(NaN, 1); table.set(-0, 2); table.set(0, 2); table.set(-0, 2); const o = {}; table.set(o, o); table.set(o, o); }

const items: Named[] = []; for (let i = 0; i < 40; i++) items.push({ name: "n" + (i % 13), rank: i });
const table = new Map<string, Named>(); lines.push("twice " + twice(table, items) + " " + [...table.values()].map(v => v.rank).join());
{ const m = new Map<string, number>(); otherValue(m, "k"); lines.push("another value " + show(m)); }
{ const m = new Map<string, number>(); otherKey(m, "a", "b"); otherKey(m, "c", "c"); lines.push("another key " + show(m)); }
{ const a = new Map<string, number>(), b = new Map<string, number>(); otherMap(a, b, "k"); otherMap(a, a, "l"); lines.push("another map " + show(a) + " | " + show(b)); }
{ const m = new Map<string, number>(); deletedBetween(m, "k"); lines.push("deleted between " + show(m)); }
{ const m = new Map<string, number>([["old", 9]]); clearedBetween(m, "k"); lines.push("cleared between " + show(m)); }
{ const m = new Map<string, number>(); codeBetween(m, "k", () => { m.delete("k"); m.set("other", 5); }); lines.push("code between " + show(m)); }
{ const m = new Map<string, number>(); lines.push("chained " + chained(m, "k") + " " + show(m)); }
{ const m = new Map<string, Named>(); keyReadTwice(m, { name: "same", rank: 1 }, false); keyReadTwice(m, { name: "before", rank: 2 }, true); lines.push("the key read twice " + [...m.keys()].join()); }
{ const m = new Map<unknown, unknown>(); oddKeys(m); lines.push("odd keys " + m.size + " " + [...m.keys()].map(k => Object.is(k, -0) ? "-0" : typeof k === "object" ? "object" : String(k)).join()); }
class Counting extends Map<string, number> { calls = 0; override set(key: string, value: number) { this.calls++; return super.set(key, value); } }
{ const m = new Counting(); otherKey(m, "x", "x"); m.set("y", 1); m.set("y", 1); lines.push("a class below Map " + m.calls + " " + show(m)); }
console.log(lines.join("\n"));
