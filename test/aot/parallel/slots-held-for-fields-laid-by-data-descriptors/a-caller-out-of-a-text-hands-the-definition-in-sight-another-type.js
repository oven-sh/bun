// The constructor lays `works` by a data descriptor, read-only and not configurable: what it is handed, or else new works. Every call in sight hands it nothing, and the slot is held to what is seen defined. Code out of a text calls the constructor with a text: the definition in sight lays it, and the object is finished like every other.
// STATISTIC: FieldTypesEnforced >= 1
// COUNTER: FieldsEvictedByTypeMismatch >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
function Clock(teeth, given) {
  Object.defineProperty(this, "works", { value: given ?? new Works(teeth), enumerable: false });
  this.face = teeth;
}
function tell(clock) {
  let teeth = 0, texts = 0, absent = 0;
  for (let i = 0; i < 9; i++) {
    const works = clock.works;
    if (typeof works === "string") texts++;
    else if (works === undefined) absent++;
    else teeth = (teeth + works.teeth) | 0;
  }
  return teeth + ":" + texts + ":" + absent;
}
function show(clock) {
  const found = Object.getOwnPropertyDescriptor(clock, "works");
  if (found === undefined) return "absent";
  return typeof found.value + " " + found.writable + " " + found.enumerable + " " + found.configurable;
}
const make = (0, eval)("(Maker, teeth, given) => new Maker(teeth, given)");
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  const clock = turn === when ? make(Clock, 3, "text") : new Clock(turn & 7);
  said = tell(clock) + " " + show(clock) + " " + Object.keys(clock).join();
}
console.log(said);
