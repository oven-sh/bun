"use strict";
function Fault(text) { this.text = text; }
Fault.prototype = Object.create(Map.prototype);
Fault.prototype.constructor = Fault;
class Box { constructor(n) { this.held = new Fault("a" + n); } }
function tell(box, turns) {
  let lists = 0;
  for (let i = 0; i < turns; i++) { const held = box.held; if (Array.isArray(held)) lists++; }
  return lists;
}
const boxes = [];
for (let i = 0; i < 40; i++) boxes.push(new Box(i));
let seen = 0;
for (const box of boxes) seen += tell(box, 9);
(0, eval)("(holder, value) => { holder.held = value; }")(boxes[0], [1, 2, 3]);
console.log(seen, tell(boxes[0], 9), tell(boxes[1], Number(process.argv[2] ?? 9)));
