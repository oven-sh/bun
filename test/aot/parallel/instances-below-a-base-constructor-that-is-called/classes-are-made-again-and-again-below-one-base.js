// Six thousand classes come and go below one base constructor: a prototype that has died may give its address to the next, and what was remembered of it must be gone by then.
"use strict";
class Base { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + 1 + work; } }
function makeClasses(tag) {
  class Left extends Base { constructor(n) { super(n); this.mark = n + tag; } which() { return "left" + tag; } }
  class Right extends Base { constructor(n) { super(n); this.mark = n - tag; this.more = tag; } which() { return "right" + tag; } }
  return [Left, Right];
}
let sum = 0, wrong = 0;
const kept = [];
for (let turn = 0; turn < 3000; turn++) {
  const [Left, Right] = makeClasses(turn);
  for (let i = 0; i < 12; i++) {
    const one = i & 1 ? new Left(i) : new Right(i);
    if (Object.getPrototypeOf(one) !== (i & 1 ? Left : Right).prototype || !(one instanceof Base) || one.which() !== (i & 1 ? "left" : "right") + turn) wrong++;
    sum += one.mark + one.size + Object.keys(one).length;
    if ((turn * 12 + i) % 977 === 0) kept.push(one);
  }
  if (turn % 500 === 499 && typeof Bun !== "undefined") Bun.gc(true);
}
console.log(sum, wrong, kept.length, kept.map(one => one.which() + ":" + one.mark + ":" + Object.keys(one).join("/")).slice(0, 6).join(" "));
