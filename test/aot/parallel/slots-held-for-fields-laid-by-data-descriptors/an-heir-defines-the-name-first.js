// The constructor lays `works` by a data descriptor, read-only and not configurable, and its slot is held to what is seen defined. An heir defines the name first, configurable, with a text, and then calls the constructor on its object.
// STATISTIC: FieldsHeldToWhatIsSeen >= 2
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
const slot = "h" + (Date.now() > 0 ? "idden" : "");
function hide(value) { globalThis[slot] = value; return globalThis[slot]; }
function Tower(teeth, value) {
  Object.defineProperty(this, "works", { value, configurable: true });
  Clock.call(this, teeth, null);
}
Tower.prototype = Object.create(Clock.prototype);
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  const clock = turn === when ? new Tower(turn & 7, hide("text")) : new Clock(turn & 7, null);
  said = tell(clock) + " " + show(clock) + " " + Object.keys(clock).join();
}
console.log(said);
