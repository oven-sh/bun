// The constructor lays `works` by a data descriptor, read-only and configurable. Its slot is held to what is seen defined. Code out of a text defines it again with a text, which the language lets it do.
// STATISTIC: FieldsHeldToWhatIsSeen >= 2
// COUNTER: FieldsLeftSlotByStoreOfOtherType >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
class Works { constructor(teeth) { this.teeth = teeth; this.turns = 1; } }
function Clock(teeth) {
  Object.defineProperty(this, "works", { value: new Works(teeth), enumerable: false, configurable: true });
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
const again = (0, eval)("(it, value) => { Object.defineProperty(it, 'works', { value }); }");
const when = Number(process.argv[2] ?? 299);
let said = "";
for (let turn = 0; turn < 300; turn++) {
  const clock = new Clock(turn & 7);
  if (turn === when) again(clock, hide("text"));
  said = tell(clock) + " " + show(clock) + " " + Object.keys(clock).join();
}
console.log(said);
