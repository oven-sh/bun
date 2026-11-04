// COUNTER: FieldsLeftSlotByStoreOfOtherType >= 9 Todo: no slot is held to a type since 11-03 08:25 (plan/AOTSlotPlan.cpp, typeHeldOfFieldForSlotPlan()): it bought nothing and cost the servers 1 to 5%
// Every store of the program brings an object of one layout to `point`, so that `holder.point.x` can be two loads. Code that the build has not seen stores primitives, objects of other layouts, ordinary objects with the same names,
// lists, functions, a proxy of the very object and an object below it. None of them may lie in the slot.
class Holder {
  point: { x: number; y: number };
  constructor(seed: number) {
    this.point = { x: 1, y: 2 };
  }
}
function other(): unknown {
  return { x: 1, y: 2, z: 3 };
}
function read(holder: Holder): unknown {
  return holder.point.x + holder.point.y;
}
function between(holder: Holder, deed: (holder: Holder, value: unknown) => void, value: unknown): string {
  const before = holder.point.x;
  deed(holder, value);
  let after: unknown;
  try {
    after = read(holder);
  } catch (error) {
    after = (error as Error).name;
  }
  return before + " " + after;
}
const store = (0, eval)("(h, v) => { h.point = v; }");
console.log(between(new Holder(1), store, 5));
console.log(between(new Holder(1), store, null));
console.log(between(new Holder(1), store, other()));
console.log(between(new Holder(1), store, new Holder(2)));
console.log(between(new Holder(1), store, new Holder(2).point));
console.log(between(new Holder(1), (0, eval)("h => { h.point = { x: 'a', y: 'b' }; }"), 0));
console.log(between(new Holder(1), (0, eval)("h => { h.point = [7, 8]; }"), 0));
console.log(between(new Holder(1), (0, eval)("h => { h.point = () => 1; }"), 0));
console.log(between(new Holder(1), (0, eval)("h => { h.point = new Proxy(h.point, {}); }"), 0));
console.log(between(new Holder(1), (0, eval)("h => { h.point = Object.create(h.point); }"), 0));
console.log(between(new Holder(1), (0, eval)("h => { h.point.x = 'text'; }"), 0));
