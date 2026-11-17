const log: string[] = []; const drawer: unknown[] = [0, "text", [1]]; const key = {}; const other = {};
function left<T extends object>(value: T): T { drawer[3] = value; return drawer[3 + (log.length & 0)] as T; }
function ask(table: WeakMap<object, number>, seen: WeakSet<object>, sized: Map<string, number> | Set<string>): void { log.push([table.set(key, 5) === table, table.get(key), table.has(other), seen.has(key), sized.size].map(String).join(" ")); }
class Loud extends WeakMap<object, number> { get(): number { return -1; } }
for (let turn = 0; turn < 200; turn++) { log.length = 0; ask(left(new WeakMap()), left(new WeakSet([key])), left(new Map([["a", 1]])));
  const own = new WeakMap<object, number>(); (own as any).get = () => "own"; const marked = new WeakSet<object>([key]); (marked as any).has = () => "mine"; const sized = new Set(["a", "b"]); Object.defineProperty(sized, "size", { value: "many" }); ask(left(own), left(marked), left(sized));
  const moved = new WeakMap<object, number>(); Object.setPrototypeOf(moved, { __proto__: WeakMap.prototype, has() { return "above"; } }); const below = new WeakSet<object>(); Object.setPrototypeOf(below, { __proto__: WeakSet.prototype, has() { return "below"; } });
  const wide = new Map([["a", 1]]); Object.setPrototypeOf(wide, { __proto__: Map.prototype, get size() { return "wide"; } }); ask(left(moved), left(below), left(wide)); ask(left(new Loud()), left(new WeakSet()), left(new Set<string>())); }
console.log(log.join("\n"));
