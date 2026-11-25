// answers: without-library
// # If the literal that is stored under `prototype` were followed as the prototype object while the record of its getter still named the literal, a read of the name on an object of the function would find nothing and give undefined.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
function Stack() { this.items = []; this.depth = 0; }
Stack.prototype = {
  push: function (v) { this.items[this.depth++] = v; return this; },
  pop: function () { return this.items[--this.depth]; },
  get size() { return this.depth; },
  set size(v) { this.depth = v; },
};
function size(s) { return s.size; }
const s = new Stack();
report(size(s));
report(size(s.push(1).push(2)));
s.size = 1;
report(s.depth);
report(s.pop());
let total = 0;
for (let i = 0; i < 300; i++) { const t = new Stack(); t.push(i).push(1); total += size(t) + t.pop(); }
report(total);
function run(count) { const u = new Stack(); let sum = 0; for (let i = 0; i < count; i++) { u.push(i & 15).push(1); sum += u.pop() + u.size + u.pop(); } return sum; }
report(run(300));
function Only() { this.n = 3; }
Only.prototype = { constructor: Only, bump: function () { this.n++; return this; }, get twice() { return this.n * 2; } };
function twice(count) { const o = new Only(); let sum = 0; for (let i = 0; i < count; i++) sum += o.bump().twice; return sum; }
report(twice(10));
report(new Only().twice);
report(Object.keys(s).join());
report("end");
