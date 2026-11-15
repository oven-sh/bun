// The receiver is an heir with a method of its own, an object that only looks alike, or the method is replaced on the prototype while the program runs.
class Scope { run(task, receiver, ...values) { return "scope:" + task.apply(receiver, values); } }
class Heir extends Scope { run(task, receiver, ...values) { return "heir:" + values.length; } }
function wrap(scope, task) { return function (...values) { return scope.run(task, this, ...values); }; }
const join = function (...values) { return values.join(); };
const wrapped = [wrap(new Scope(), join), wrap(new Heir(), join), wrap({ run(task, receiver, ...values) { return "literal:" + values.join("+"); } }, join)];
let last = "";
for (let i = 0; i < 300; i++) last = wrapped.map(f => f(i, "a")).join(" ");
console.log(last);
Scope.prototype.run = function (task, receiver, ...values) { return "replaced:" + values.length; };
for (let i = 0; i < 300; i++) last = wrapped.map(f => f(i, "a")).join(" ");
console.log(last);
const own = new Scope(); own.run = function (task, receiver, ...values) { return "own:" + values.join("/"); };
console.log(wrap(own, join)(1, 2), wrap(Object.create(new Scope()), join)(3));
