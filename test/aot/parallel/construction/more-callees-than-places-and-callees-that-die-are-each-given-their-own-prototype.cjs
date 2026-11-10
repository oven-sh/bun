// Env of the executable: BUN_JSC_verifyGC=1
"use strict";
const hide = new Function("K", "return [K]");
function makeCallee(number) { const made = hide(function (x) { this.x = x; this.of = number; })[0]; made.prototype.number = number; return made; }
const many = []; for (let i = 0; i < 300; i++) many.push(makeCallee(i));
let wrong = 0, sum = 0;
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < many.length; i++) {
    const made = new many[i](round);
    if (made.number !== i || made.of !== i || Object.getPrototypeOf(made) !== many[i].prototype) wrong++;
    sum = (sum + made.number + made.x) % 1000003;
  }
}
console.log("three hundred in turn", wrong, sum);
wrong = 0;
for (let round = 0; round < 3000; round++) {
  const shortLived = makeCallee(round);
  for (let i = 0; i < 3; i++) { const made = new shortLived(i); if (made.number !== round || Object.getPrototypeOf(made) !== shortLived.prototype) wrong++; }
  if (round % 500 === 499) Bun.gc(true);
}
console.log("callees that die", wrong);
const kept = []; for (let i = 0; i < 2000; i++) kept.push(new many[i % 300](i));
Bun.gc(true);
console.log("what was made outlives a collection", kept.every((made, i) => made.number === i % 300 && made.x === i));
class Below extends many[0] { constructor() { super(1); this.below = true; } }
console.log("another new.target", new Below().number, new Below().below, Object.getPrototypeOf(new Below()) === Below.prototype, Reflect.construct(many[1], [2], many[2]).number, new (many[3].bind(null, 4))().number, new (new Proxy(many[4], {}))(5).number);
