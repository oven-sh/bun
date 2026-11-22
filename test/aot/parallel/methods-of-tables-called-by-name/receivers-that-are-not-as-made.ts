const said: unknown[] = [];
const show = (v: unknown) => (v instanceof Map || v instanceof Set ? JSON.stringify([...v]) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function count(table: Map<string, number>, name: string): void {
  const old = table.get(name);
  said.push(table.set(name, (old ?? 0) + 1) === table, table.has(name), table.delete(name + "!"), table.get(name));
}
function mark(seen: Set<string>, name: string): void {
  said.push(seen.has(name), seen.add(name) === seen, seen.has(name), seen.delete("none"), seen.delete(name));
}
class Counting extends Map<string, number> { gets = 0; get(key: string): number | undefined { this.gets++; return super.get(key); } }
class Quiet extends Map<string, number> {}
class Loud extends Set<string> { adds = 0; add(key: string): this { this.adds++; return super.add(key); } }
for (let turn = 0; turn < 200; turn++) { said.length = 0;
  const name = "n" + (turn & 3);
  const plain = new Map<string, number>(); count(plain, name); count(plain, name);
  const named = new Map<string, number>() as Map<string, number> & { extra?: number }; named.extra = 1; count(named, name);
  const own = new Map<string, number>(); (own as unknown as { get: unknown }).get = function () { return 41; }; count(own, name);
  const ownSet = new Map<string, number>(); (ownSet as unknown as { set: unknown }).set = function () { return "own set"; }; count(ownSet, name);
  const below = new Map<string, number>(); Object.setPrototypeOf(below, { __proto__: Map.prototype, set(this: Map<string, number>, k: string, v: number) { return Map.prototype.set.call(this, k, v * 10); }, has() { return "own has"; }, delete() { return "own delete"; } }); count(below, name);
  const counting = new Counting(); count(counting, name); const quiet = new Quiet(); count(quiet, name);
  const frozen = Object.freeze(new Map<string, number>()); count(frozen, name);
  const bare = new Map<string, number>(); Object.setPrototypeOf(bare, null);
  try { count(bare, name); } catch (e) { said.push((e as Error).constructor.name); }
  said.push(plain, named, own, ownSet, below, counting, counting.gets, quiet, frozen);
  const set = new Set<string>(); mark(set, name); const odd = new Set<string>(); (odd as unknown as { has: unknown }).has = () => "own has"; mark(odd, name);
  const loud = new Loud(); mark(loud, name); said.push(set, odd, loud, loud.adds);
}
console.log(said.map(show).join(" "));
