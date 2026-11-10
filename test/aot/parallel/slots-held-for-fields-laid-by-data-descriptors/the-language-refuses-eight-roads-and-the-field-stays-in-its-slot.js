// The constructor lays `works` by a data descriptor, read-only and not configurable, and its slot is held to what is seen defined. Code out of a text tries eight roads that the language refuses on such a field, which one by a parameter or all. The field stays in its slot.
// STATISTIC: FieldsHeldToWhatIsSeen >= 2
// COUNTER: FieldsLeftSlotByStoreOfOtherType = 0
// COUNTER: FieldsLeftSlotByRedefinition = 0
// COUNTER: FieldsLeftSlotByDelete = 0
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
const roads = (0, eval)(`[["a store in sloppy code", (it, value) => { it.works = value; return "dropped"; }],
 ["a store in strict code", function (it, value) { "use strict"; it.works = value; return "stored"; }],
 ["a second definition", (it, value) => { Object.defineProperty(it, "works", { value }); return "defined"; }],
 ["Reflect.defineProperty", (it, value) => String(Reflect.defineProperty(it, "works", { value }))],
 ["Reflect.set", (it, value) => String(Reflect.set(it, "works", value))],
 ["Object.assign", (it, value) => { Object.assign(it, { works: value }); return "assigned"; }],
 ["delete", (it) => String(delete it.works)],
 ["a store through an heir", (it, value) => { const heir = Object.create(it); heir.works = value; return String(Object.hasOwn(heir, "works")); }]]`);
const only = process.argv[2];
for (const [name, road] of roads) {
  if (only !== undefined && only !== name) continue;
  let clock = null, answer;
  for (let turn = 0; turn < 300; turn++) { clock = new Clock(turn & 7, null); tell(clock); }
  try { answer = road(clock, hide("text")); } catch (error) { answer = error.constructor.name; }
  console.log(name + ": " + answer + " " + tell(clock) + " " + show(clock) + " " + Object.keys(clock).join());
}
