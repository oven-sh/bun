// answers: without-library
// # If the literal that is stored under `prototype` counted as there from the start, the object made in front of the store would find its methods, and `constructor` would find the function where the literal has none. A literal that the program keeps hold of is followed by nobody.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
function Stack() { this.items = []; this.depth = 0; }
const early = new Stack();
function size(s) { return s.size === undefined ? "no size" : s.size(); }
function who(s) { return s.constructor === Stack ? "Stack" : s.constructor === Object ? "Object" : "other"; }
report(size(early));
report(who(early));
Stack.prototype = {
  push: function (v) { this.items[this.depth++] = v; return this; },
  pop: function () { return this.items[--this.depth]; },
  size: function () { return this.depth; },
};
const late = new Stack();
report(size(early));
report(size(late));
report(who(early));
report(who(late));
report(late.push(4).push(5).size());
report(late.pop() + late.pop());
Stack.prototype.peek = function () { return this.items[this.depth - 1]; };
report(late.push(9).peek());
report(early.peek === undefined);
report(early instanceof Stack);
report(late instanceof Stack);
let total = 0;
for (let i = 0; i < 300; i++) { const s = new Stack(); s.push(i).push(1); total += s.pop() + s.pop() + s.size(); }
report(total);
report(Object.keys(Stack.prototype).join());
function Kept() { this.k = 1; }
const shared = { get: function () { return this.k; } };
Kept.prototype = shared;
shared.more = function () { return this.k + 1; };
const kept = new Kept();
report(kept.get() + kept.more());
report(Object.getPrototypeOf(kept) === shared);
report("end");
