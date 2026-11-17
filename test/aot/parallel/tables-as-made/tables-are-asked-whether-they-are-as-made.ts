const out: string[] = [];
const keyOfWeak = { weak: 1 }, mine = function (this: unknown, ...given: unknown[]): string { return "mine(" + given.length + ")"; };
function gets(t: Map<unknown, unknown>, k: unknown): unknown { return t.get(k); }
function hasInMap(t: Map<unknown, unknown>, k: unknown): unknown { return t.has(k); }
function sets(t: Map<unknown, unknown>, k: unknown): unknown { const r = t.set(k, "set"); return r === t ? "itself " + String(Map.prototype.get.call(t, k)) : r; }
function hasInSet(t: Set<unknown>, k: unknown): unknown { return t.has(k); }
function adds(t: Set<unknown>, k: unknown): unknown { const r = t.add(k); return r === t ? "itself " + String(Set.prototype.has.call(t, k)) : r; }
function getsWeak(t: WeakMap<object, unknown>, k: object): unknown { return t.get(k); }
function hasInWeakSet(t: WeakSet<object>, k: object): unknown { return t.has(k); }
function twice(t: Map<unknown, unknown>, k: unknown, between: (t: any) => void): string { const first = t.get(k); between(t); return String(first) + " then " + String(t.get(k)); }
function inLoop(t: Map<unknown, unknown>, keys: unknown[], at: number, between: (t: any) => void): string { let said = ""; for (let i = 0; i < keys.length; i++) { if (i === at) between(t); said += String(t.get(keys[i])) + ","; } return said; }
const kinds: Record<string, { make: () => any; asks: [string, (t: any) => unknown][] }> = {
  map: { make: () => new Map<unknown, unknown>([[1, "one"]]), asks: [["get", t => gets(t, 1)], ["has", t => hasInMap(t, 1)], ["set", t => sets(t, 2)]] },
  set: { make: () => new Set<unknown>([1]), asks: [["has", t => hasInSet(t, 1)], ["add", t => adds(t, 2)]] },
  weakMap: { make: () => new WeakMap<object, unknown>([[keyOfWeak, "weak"]]), asks: [["get", t => getsWeak(t, keyOfWeak)]] },
  weakSet: { make: () => new WeakSet<object>([keyOfWeak]), asks: [["has", t => hasInWeakSet(t, keyOfWeak)]] },
};
const changes: Record<string, (t: any) => any> = {
  asMade: t => t,
  taggedByAName: t => { t.tag = 1; return t; },
  aMethodLaidOnIt: t => { t.get = t.has = t.set = t.add = mine; return t; },
  itsPrototypeChanged: t => Object.setPrototypeOf(t, { get: mine, has: mine, set: mine, add: mine }),
  itsPrototypeChangedToAnHeirOfTheClass: t => Object.setPrototypeOf(t, Object.create(Object.getPrototypeOf(t))),
  frozen: t => Object.freeze(t),
  sealed: t => Object.seal(t),
  aNumericNameOfItsOwn: t => { t["1.5"] = 1; return t; },
  anElementOfItsOwn: t => { t[0] = 1; return t; },
  anAccessorAmongItsElements: t => Object.defineProperty(t, 0, { get() { return "got"; } }),
  aSymbolOfItsOwn: t => { t[Symbol.iterator] = mine; return t; },
};
const say = (name: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (e) { said = (e as Error).name; } out.push(name + " " + said); };
for (let round = 0; round < 2; round++) for (const kind in kinds) for (const change in changes) for (const [name, ask] of kinds[kind].asks) say(kind + "." + name + " " + change, () => ask(changes[change](kinds[kind].make())));
class Heir extends Map<unknown, unknown> { }
class Overrides extends Map<unknown, unknown> { get(k: unknown): unknown { return "over " + String(super.get(k)); } has(): boolean { return false; } }
class HeirOfSet extends Set<unknown> { has(): boolean { return false; } }
for (let round = 0; round < 2; round++) {
  say("an heir", () => gets(new Heir([[1, "heir"]]), 1)); say("an heir that overrides", () => String(gets(new Overrides([[1, "heir"]]), 1)) + " " + String(hasInMap(new Overrides([[1, 1]]), 1)));
  say("an heir of sets that overrides", () => hasInSet(new HeirOfSet([1]), 1)); say("a set for a map", () => gets(new Set([1]) as any, 1)); say("nothing", () => gets(null as any, 1)); say("a stranger", () => gets({ get: mine } as any, 1));
  for (const change in changes) say("twice " + change, () => twice(new Map([[1, "one"]]), 1, t => { changes[change](t); }));
  for (const change in changes) say("in a loop " + change, () => inLoop(new Map<unknown, unknown>([[1, "one"], [2, "two"], [3, "three"]]), JSON.parse("[1,2,3,1]"), 2, t => { changes[change](t); }));
}
console.log("SAID\n" + out.join("\n"));
export {};
