const said: unknown[] = [];
const show = (v: unknown) => (v instanceof Map || v instanceof Set ? JSON.stringify([...v]) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function fill(table: Map<string, number>, names: string[]): void {
  for (const name of names) {
    const old = table.get(name);
    if (old === undefined) table.set(name, 1); else table.set(name, old + 1);
    said.push(table.has(name), table.size, table.delete(name + "!"));
  }
}
function mark(seen: Set<string>, names: string[]): void {
  for (const name of names) { if (!seen.has(name)) seen.add(name); said.push(seen.size, seen.delete("none")); }
}
class Counting extends Map<string, number> { gets = 0; get(key: string): number | undefined { this.gets++; return super.get(key); } }
for (let turn = 0; turn < 300; turn++) { said.length = 0;
  const names = ["a", "b", "a", "c" + (turn & 1)];
  const plain = new Map<string, number>(); fill(plain, names);
  const named = new Map<string, number>() as Map<string, number> & { extra?: number }; named.extra = 1; fill(named, names);
  const own = new Map<string, number>(); (own as unknown as { get: unknown }).get = function () { return 41; }; fill(own, names);
  const below = new Map<string, number>(); Object.setPrototypeOf(below, { __proto__: Map.prototype, set(this: Map<string, number>, k: string, v: number) { return Map.prototype.set.call(this, k, v * 10); }, has() { return "own has"; } }); fill(below, names);
  const counting = new Counting(); fill(counting, names);
  const frozen = Object.freeze(new Map<string, number>()); fill(frozen, names);
  said.push(plain, named, own, below, counting, counting.gets, frozen);
  const set = new Set<string>(); mark(set, names); const odd = new Set<string>(); (odd as unknown as { has: unknown }).has = () => true; mark(odd, names); said.push(set, odd);
}
console.log(said.map(show).join(" "));
