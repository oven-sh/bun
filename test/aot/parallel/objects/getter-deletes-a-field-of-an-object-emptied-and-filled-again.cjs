// The object is kept from round to round, so its key order comes to belong to it alone and changes in place: nothing but a look at the object says that the getter has deleted `later`.
const held = {};
let round = 0;
function make(i) {
  const made = held;
  for (const name of Reflect.ownKeys(made)) delete made[name];
  Object.defineProperty(made, "counted", { get() { if (round >= 10) delete this.later; return 1; }, enumerable: true, configurable: true });
  made.later = "later";
  for (let at = 0; at < 6; at++) made["made " + i + " " + at] = at;
  return made;
}
for (round = 0; round < 20; round++) console.log(round, Object.keys(Object.assign({}, make(round))).join());
for (round = 0; round < 20; round++) console.log(round, Object.keys({ ...make(round) }).join());
for (round = 0; round < 20; round++) { const { counted, ...rest } = make(round); console.log(round, counted, JSON.stringify(rest)); }
