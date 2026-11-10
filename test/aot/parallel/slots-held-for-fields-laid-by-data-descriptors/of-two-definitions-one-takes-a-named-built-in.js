// The constructor lays `works` by a data descriptor, read-only and not configurable, in one of two definitions: new works, or what a variable holds. Nobody knows what the variable holds, so what arrives says nothing; the slot is held to what the maker is seen to make. The variable holds Math.
// STATISTIC: FieldTypesEnforced >= 2
// COUNTER: FieldsEvictedByTypeMismatch >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
let refusals = 0, given = null;
function Clock(teeth, early) {
  if (early !== null) early(this);
  try { if (given === null) Object.defineProperty(this, "works", { value: new Works(teeth), enumerable: false }); else Object.defineProperty(this, "works", { value: given, enumerable: false }); } catch (error) { refusals++; }
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
function early(it) { kept = it; given = Math; }
const when = Number(process.argv[2] ?? 299);
let kept = null, said = "";
for (let turn = 0; turn < 300; turn++) {
  let clock, thrown = "";
  try { clock = new Clock(turn & 7, turn === when ? early : null); } catch (error) { clock = kept; thrown = error.constructor.name + " "; }
  said = thrown + tell(clock) + " " + show(clock) + " " + Object.keys(clock).join() + " " + refusals;
}
console.log(said);
