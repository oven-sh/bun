// The constructor lays `works` by a data descriptor, read-only and not configurable, and its slot is held to what is seen defined. One object leaves before that and the constructor ends early. Code out of a text defines the name with a text between two reads of one turn of a loop.
// STATISTIC: FieldTypesEnforced >= 2
// COUNTER: FieldsEvictedByTypeMismatch >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
function Clock(teeth, early) {
  if (early !== null) { early(this); return; }
  Object.defineProperty(this, "works", { value: new Works(teeth), enumerable: false });
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
const slot = "h" + (Date.now() > 0 ? "idden" : "");
function hide(value) { globalThis[slot] = value; return globalThis[slot]; }
const define = (0, eval)("(it, value) => { Object.defineProperty(it, 'works', { value }); }");
function early(it) {}
function tellAround(clock, at) {
  let teeth = 0, others = 0, absent = 0;
  for (let i = 0; i < 9; i++) {
    const before = clock.works;
    if (before === undefined) absent++;
    if (i === at) define(clock, hide("text"));
    const after = clock.works;
    if (typeof after === "string") others++;
    else if (after !== undefined) teeth = (teeth + after.teeth) | 0;
  }
  return teeth + ":" + others + ":" + absent;
}
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  const clock = new Clock(turn & 7, turn === when ? early : null);
  said = tellAround(clock, turn === when ? 4 : -1) + " " + tell(clock) + " " + show(clock);
}
console.log(said);
