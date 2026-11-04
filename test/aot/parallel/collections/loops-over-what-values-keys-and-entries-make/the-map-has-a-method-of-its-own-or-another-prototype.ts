// The method that is called is the one that a read finds.
const make = () => new Map<string, number>([["a", 1], ["b", 2]]);
function all(map: Map<string, number>) { const seen: unknown[] = []; for (const value of map.values()) seen.push(value); for (const key of map.keys()) seen.push(key); for (const pair of map.entries()) seen.push(pair.join("=")); return seen.join(); }
console.log(all(make()));
const own = make(); (own as any).values = function () { return ["own values"][Symbol.iterator](); };
console.log(all(own));
const getter = make(); let reads = 0; Object.defineProperty(getter, "keys", { get() { reads++; return () => ["from a getter"][Symbol.iterator](); } });
console.log(all(getter), reads);
const below = make(); Object.setPrototypeOf(below, { __proto__: Map.prototype, entries() { return [["another", "prototype"]][Symbol.iterator](); } });
console.log(all(below));
const named = make(); (named as any).other = 1;
console.log(all(named));
const noFunction = make(); (noFunction as any).values = 5;
try { console.log(all(noFunction)); } catch (error) { console.log((error as Error).constructor.name); }
const frozen = Object.freeze(make());
console.log(all(frozen));
