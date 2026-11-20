// Accessors that read a name off what lies under another name, while evaluated code changes what they reach: the object, the accessor above it, the accessor itself and its prototype.
"use strict";
function lend(on, through, name) {
  Object.defineProperty(on, name, {
    configurable: true,
    get() {
      return this[through][name];
    },
    set(value) {
      this[through][name] = value;
    },
  });
}
const gate = {}, post = { get tall() { return this.feet * 12; }, set tall(value) { this.feet = value / 12; } };
for (const name of ["tall", "feet", "wood"]) lend(gate, "post", name);
function make(feet, wood) {
  const one = Object.create(gate);
  one.post = Object.create(post);
  one.post.feet = feet;
  one.post.wood = wood;
  return one;
}
function measure(one, turns, at, run) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === at) run(one, gate, post);
    sum += one.tall + one.feet + one.wood.length;
    one.tall = 12 + turn;
  }
  return sum;
}
const changes = [
  "",
  "one.post = { tall: 1, feet: 2, wood: 'ab' };",
  "Object.defineProperty(one.post, 'tall', { get: function () { return 5; }, set: function () {} });",
  "Object.defineProperty(one, 'feet', { value: 1000 });",
  "one.post.wood = 'evaluated';",
  "Object.setPrototypeOf(one.post, { tall: 7 });",
  "Object.defineProperty(post, 'tall', { configurable: true, get: function () { return -this.feet; }, set: function (v) { this.feet = v; } });",
  "Object.defineProperty(gate, 'wood', { configurable: true, get: function () { return 'all gates'; } });",
  "delete gate.feet;",
  "delete one.post;",
];
for (const text of changes) {
  const run = new Function("one", "gate", "post", text);
  let said;
  try {
    said = [measure(make(2, "oak"), 30, 11, run), measure(make(3, "elm"), 20, -1, run)].join(" ");
  } catch (error) {
    said = error.constructor.name;
  }
  console.log(said, "|", text.length);
}
const one = make(4, "ash");
let total = 0;
for (let turn = 0; turn < 30; turn++) {
  try { total += measure(one, 10, 3, turn === 20 ? new Function("one", "gate", "post", "gate.name = post.name = 'x' + Object.keys(post).length; this.evaluated = 1;") : () => {}); } catch (error) { total = -turn; }
}
console.log(String(total), gate.name, (0, eval)("typeof evaluated"));
