// `list.push(a, ...other)`: the call stands in a small function that is copied in; between two turns the list is linked to a prototype that inherits the built-in push and holds a setter, which takes a property off another object and lays it on again behind a new one.
const add = (out, first, source) => { out.push(first, ...source); };
function run(deed, sources) {
  const out = [];
  const box = { value: 1, other: 2 };
  const seen = [];
  for (let turn = 0; turn < sources.length; turn++) {
    if (turn === 2) deed(out, box);
    const before = box.value + box.other;
    add(out, turn, sources[turn]);
    seen.push(before + ">" + box.value + ":" + box.other + ":" + Object.keys(box).join(""));
  }
  return seen.join(" | ") + " || " + JSON.stringify(out);
}
const sources = [[1], [2, 3], [4, 5], [6], [7, 8]];
const between = offset => (out, box) =>
  Object.setPrototypeOf(out, Object.create(Array.prototype, { [out.length + offset]: { configurable: true, get() { return "got"; }, set(value) { delete box.value; box.extra = "e"; box.value = 90 + value; box.other = "o"; } } }));
console.log(run(() => {}, sources));
for (const offset of [0, 1, 2, 4]) console.log(offset, run(between(offset), sources));
