// The getter is entered with whatever the read began at, and it may throw.
"use strict";
function checked(name) {
  return {
    get() {
      if (!(name in this)) throw new TypeError("no " + name);
      return this[name];
    },
  };
}
function Box(value) {
  if (value !== undefined) this.value = value;
}
Object.defineProperties(Box.prototype, { content: checked("value"), size: checked("length") });
function run(boxes) {
  let text = "";
  for (const box of boxes) {
    try {
      text += box.content + " ";
    } catch (error) {
      text += error.message + " ";
    }
  }
  return text;
}
globalThis.runFromOutside = run;
const boxes = [new Box(1), new Box(), new Box(3), new Box("four")];
for (let turn = 0; turn < 5000; turn++) run(boxes);
console.log(run(boxes));
console.log(
  runFromOutside([Box.prototype, Object.create(new Box(3)), { content: 4 }, new Box(5), 6, "seven"]),
  Reflect.get(Box.prototype, "size", [1, 2, 3, 4]),
);
