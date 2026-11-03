// A function that waits keeps its integers in its saved frame as plain words. The collector runs while 20,000 of them wait, each with another integer,
// and many of those integers, read as a 32-bit reference, would name a cell that is dead or free by then. They are integers: each comes back as it was.
let open;
const gate = new Promise(resolve => { open = resolve; });
async function hold(value) {
  const integer = value | 0;
  await gate;
  return integer;
}
function makeGarbage(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push({ i, twice: i * 2, text: null });
  return list.length;
}
const first = 1 << 21;
const count = 20000;
const numberAt = i => first + 2 * i * 401;
console.log(makeGarbage(3_000_000));
const waiting = [];
for (let i = 0; i < count; i++) waiting.push(hold(numberAt(i)));
Bun.gc(true);
open();
const answers = await Promise.all(waiting);
let changed = 0;
let example = "";
for (let i = 0; i < count; i++) {
  if (answers[i] !== numberAt(i)) {
    if (!changed) example = numberAt(i) + " came back as " + answers[i];
    changed++;
  }
}
console.log("changed:", changed, example);
