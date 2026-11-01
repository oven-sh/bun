// A closure made anew in each turn is read by name and by a key known at run time, in a function that a loop inside a block calls: both read one value, and the comparison is true. Then a store of another kind changes the field.
const word = Function("text", "return text");
const store = Function("held", "name", "value", "held[name] = value;");
const notes = new Map();
function note(value) {
  const text =
    typeof value === "function"
      ? "function " + value.name
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  notes.set(text, (notes.get(text) ?? 0) + 1);
}
function said() {
  const text = [...notes].map(([each, times]) => each + " x" + times).join("; ");
  notes.clear();
  return text;
}
class Held4 {
  
  constructor(given) {
    if (given) this.n4value = () => 1;
  }
}
const key4 = word("n4value");
function read4(held) {
  return held.n4value;
}
function make4(turn) {
  return { n4value: () => 1 };
}
function change4(loose, y) {
  Object.assign(loose, JSON.parse('{"n4value":2}'));
}
function run4(y, turn) {
  const o = make4(turn);
  const loose = o;
  note(o.n4value === loose[key4]);
  change4(o, y);
  note(Object.hasOwn(o, "n4value"));
  note(Object.entries(o).map(([name, value]) => name + typeof value).join());
  note(read4(o));
}
{
  let turn = 0;
  for (let round = 0; round < 3; round++) {
    for (const y of JSON.parse('[{"y":""},{"y":true},{"x":1},{"y":"a"},{"y":2},{"y":1.5},{"y":null}]').map((row) => row.y)) {
      try {
        run4(y, turn++);
      } catch (error) {
        note("threw " + error?.constructor?.name);
      }
    }
  }
  console.log("scene 4", said());
}
