// Two constructors lay `works` at one place. The first lays it by a data descriptor, read-only and not configurable; the second stores whatever it is handed. A store in sight, of works like those that the first is held to, goes through a receiver that is the one or the other by a parameter: the second takes it and the first refuses it.
// STATISTIC: FieldTypesEnforced >= 2
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
let refused = 0;
function wind(clock, teeth) { try { clock.works = new Works(teeth); } catch (error) { refused++; } }
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  const first = new Clock(turn & 7), second = new Sundial(hide("text"), 3);
  for (let i = 0; i < 9; i++) wind((turn + i) % 3 === when % 3 ? first : second, 100 + i);
  said = tell(first) + " " + show(first) + " | " + tell(second) + " " + show(second) + " | " + refused;
}
console.log(said);
