// Two constructors lay `works` at one place. The first lays it by a data descriptor, read-only and not configurable; the second stores whatever it is handed. A receiver that is the one or the other by a parameter is read in a loop: what is read is what that object holds.
// STATISTIC: FieldsHeldToWhatIsSeen >= 2
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
function Clock(teeth) {
  Object.defineProperty(this, "works", { value: new Works(teeth), enumerable: false });
  this.face = teeth;
}
function Sundial(works, face) {
  this.works = works;
  this.face = face;
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
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  const clock = turn === when ? new Sundial(hide("text"), 3) : turn & 1 ? new Sundial(hide(new Works(2)), 3) : new Clock(turn & 7);
  said = tell(clock) + " " + show(clock) + " " + Object.keys(clock).join();
}
console.log(said);
