const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error)); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function copy(items: any) { return Array.from(items); }
function copyOf(name: string) { return Array.from(box[name]); }
const make = () => new Map<string, number>([["a", 1], ["b", 2]]);
class Own extends Map<string, number> { entries(): any { log.push("entries of the class"); return [["of the class", 0]].values(); } }
class Plain extends Map<string, number> {}
class Walks extends Map<string, number> { *[Symbol.iterator](): any { log.push("the generator of the class"); yield ["generated", 0]; } }
class Both extends Map<string, number> { [Symbol.iterator](): any { log.push("by entries"); return this.entries(); } }
for (let turn = 0; turn < 3; turn++) {
  let held: any = make().entries(); held.next = function () { return { done: true }; }; say(copy(held));
  held = make().entries(); let calls = 0; const real = held.next; held.next = function () { calls++; return real.call(this); }; say(copy(held), calls);
  held = make().entries(); held[Symbol.iterator] = function () { return ["its own iterator"].values(); }; say(copy(held));
  held = make().entries(); held[Symbol.iterator] = undefined; held.length = 2; held[0] = "read as an array-like"; say(copy(held));
  held = make().entries(); held.return = function () { log.push("never called"); return {}; }; say(copy(held), told());
  held = make().entries(); held.other = 1; say(copy(held), held.other);
  held = make().entries(); Object.setPrototypeOf(held, { [Symbol.iterator]() { return [1].values(); } }); say(copy(held));
  held = make().entries(); Object.setPrototypeOf(held, null); say(copy(held));
  held = make().entries(); held.next = 5; attempt("next is no function:", () => copy(held));
  held = make().entries(); held.next = () => 5; attempt("next gives no object:", () => copy(held));
  held = Object.freeze(make().entries()); say(copy(held), held.next());
  held = new Proxy(make().entries(), {}); attempt("a Proxy of the iterator:", () => copy(held));
  say(copy(new Own([["a", 1]])), told(), copy(new Own([["a", 1]]).entries()), told(), copy(new Plain([["a", 1]])), copy(new Plain([["a", 1]]).entries()), copy(new Walks([["a", 1]])), told(), copy(new Walks([["a", 1]]).entries()), told(), copy(new Both([["a", 1]])), told(), copy(Map.prototype.entries.call(new Own([["a", 1]]))), told());
  let map: any = make(); map[Symbol.iterator] = function () { return [["on the instance", 0]].values(); }; say(copy(map), copy(map.entries()));
  map = make(); map.entries = () => [["entries on the instance", 0]].values(); say(copy(map), copy(map.entries()));
  map = make(); map[Symbol.iterator] = undefined; map.length = 1; map[0] = "read as an array-like"; say(copy(map));
  map = make(); map[Symbol.iterator] = 5; attempt("the method is no function:", () => copy(map));
  map = make(); Object.defineProperty(map, Symbol.iterator, { get() { log.push("the getter runs"); return Map.prototype.entries; } }); say(copy(map), told());
  map = make(); map.other = 1; say(copy(map)); map = Object.freeze(make()); say(copy(map));
  map = make(); Object.setPrototypeOf(map, { [Symbol.iterator]() { return [["another prototype", 0]].values(); } }); say(copy(map));
  map = make(); Object.setPrototypeOf(map, null); say(copy(map));
  map = new Proxy(make(), {}); attempt("a Proxy of a Map:", () => copy(map));
  attempt("entries of a Set by the method of Maps:", () => copy(Map.prototype.entries.call(new Set([1]) as any)));
  say(copy(new Set(["x", "y"]).entries()), copy(["x"].entries()), copy(new URLSearchParams("q=1").entries()), copy(new WeakMap() as any), copy(new Set(["x"])));
}
