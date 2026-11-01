// The constructor of Map and Set calls `set` and `add` of the object under construction.
class Counted extends Map<string, number> {
  static seen: string[] = [];
  set(key: string, value: number): this { Counted.seen.push(key + kindOf(this) + sizeOf(this)); return super.set(key, value * 2); }
}
class Other { size = -1; }
class Uniq extends Set<number> { add(value: number): this { note(this); return super.add(value + 1); } }
function kindOf(value: Counted | Other): string { return value instanceof Counted ? "C" : "O"; }
function sizeOf(value: Counted | Other): number { return value.size; }
const notes: number[] = [];
function note(value: Uniq | Other) { notes.push(value.size); }
for (let i = 0; i < 4; i++) {
  const counted = new Counted([["a", 1], ["b", 2]]);
  console.log([...counted].join(";"), kindOf(counted), sizeOf(counted), kindOf(new Other()), sizeOf(new Other()));
  const uniq = new Uniq([1, 2, 2]);
  console.log([...uniq].join(), notes.join());
  note(new Other());
}
console.log(Counted.seen.join());
class Thrower extends Map<string, number> { set(): this { throw new RangeError("no"); } }
for (let i = 0; i < 3; i++) { try { new Thrower([["a", 1]]); } catch (e) { console.log((e as Error).message); } console.log(Reflect.construct(Map, [], Thrower) instanceof Thrower, new Thrower().size); }
class Nested extends Map<string, unknown> { set(key: string, value: unknown): this { return super.set(key, key === "deep" ? new Nested([["leaf", 1]]) : Reflect.construct(Map, [], Nested)); } depth(): number { let most = 0; for (const v of this.values()) if (v instanceof Nested) most = Math.max(most, 1 + depthOf(v)); return most; } }
function depthOf(n: Nested): number { return n.depth(); }
for (let i = 0; i < 3; i++) console.log(depthOf(new Nested([["deep", 0], ["flat", 0]])));
