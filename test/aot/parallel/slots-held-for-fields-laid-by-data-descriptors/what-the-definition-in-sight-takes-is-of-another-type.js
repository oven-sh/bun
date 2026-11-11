// The constructor lays `works` by a data descriptor, read-only and not configurable: what the object has under the name already, or else new works. Code out of a text lays a text on the prototype, so the definition in sight takes the text.
// STATISTIC: FieldTypesEnforced >= 2
// COUNTER: FieldsEvictedByTypeMismatch >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
function Clock(teeth) {
  Object.defineProperty(this, "works", { value: this.works ?? new Works(teeth), enumerable: false });
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
const lay = (0, eval)("(holder, value) => { holder.works = value; }");
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  if (turn === when) lay(Clock.prototype, hide("text"));
  const clock = new Clock(turn & 7);
  said = tell(clock) + " " + show(clock) + " " + Object.keys(clock).join();
}
console.log(said);
