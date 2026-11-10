// `list.push(a, ...other)`: between two turns the program links the list to a prototype of its own that inherits the built-in push and holds an accessor under an index that the push will store to: the callee is still the built-in, and the setter runs amid the push and changes what the function reads in front of the call and behind it.
function run(lay, sources) {
  const out = [];
  const box = { value: 1, list: [1] };
  const seen = [];
  for (let turn = 0; turn < sources.length; turn++) {
    if (turn === 2) lay(out, box);
    const before = box.value, held = box.list, length = out.length;
    out.push(turn, ...sources[turn]);
    seen.push(before + ">" + box.value + " " + (held === box.list) + " " + length + ">" + out.length + " " + held.length + ">" + box.list.length);
  }
  return seen.join(" | ") + " || " + JSON.stringify(out) + " " + Object.keys(out).length;
}
const sources = [[1], [2, 3], [4, 5], [6], [7, 8]];
const between = offset => (out, box) =>
  Object.setPrototypeOf(out, Object.create(Array.prototype, { [out.length + offset]: { configurable: true, enumerable: true, get() { return "got"; }, set(value) { box.value += 10; box.list = [value, value, value]; } } }));
console.log(run(() => {}, sources));
for (const offset of [0, 1, 2, 4, 7]) console.log(offset, run(between(offset), sources));
console.log(run(out => Object.setPrototypeOf(out, Object.create(Array.prototype)), sources));
try { console.log(run(out => Object.setPrototypeOf(out, Object.create(Array.prototype, { [out.length]: { get() { return "only a getter"; } } })), sources)); } catch (error) { console.log("threw " + error.name); }
function thenOneMore(lay, sources) {
  const out = [];
  const box = { value: 1, list: [1] };
  const seen = [];
  for (let turn = 0; turn < sources.length; turn++) {
    if (turn === 2) lay(out, box);
    out.push(turn, ...sources[turn]);
    out.push("one more");
    seen.push(box.value + " " + out.length + " " + out[out.length - 1] + " " + Object.hasOwn(out, out.length - 1));
  }
  return seen.join(" | ") + " || " + JSON.stringify(out);
}
for (const offset of [2, 3, 4, 6]) console.log(offset, thenOneMore(between(offset), sources));
