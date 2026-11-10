// The constructor lays `works` by a data descriptor, read-only and not configurable, and its slot is held to what is seen defined. Nothing else happens: the reads of the loop find what the constructor laid.
// STATISTIC: FieldsHeldToWhatIsSeen >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
let refusals = 0;
function Clock(teeth, early) {
  if (early !== null) early(this);
  try { Object.defineProperty(this, "works", { value: new Works(teeth), enumerable: false }); } catch (error) { refusals++; }
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
const early = null;
const when = Number(process.argv[2] ?? 299);
let kept = null, said = "";
for (let turn = 0; turn < 300; turn++) {
  let clock, thrown = "";
  try { clock = new Clock(turn & 7, turn === when ? early : null); } catch (error) { clock = kept; thrown = error.constructor.name + " "; }
  said = thrown + tell(clock) + " " + show(clock) + " " + Object.keys(clock).join() + " " + refusals;
}
console.log(said);
