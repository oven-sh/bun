// An arrow function, a method and an async function have no prototype property. That of a generator function is no ordinary object and names no constructor.
const arrow = () => {};
const holder = { method() {}, async later() {}, *steps() {}, async *slow() {} };
async function later() {}
function* steps() { yield 1; }
const told = [];
for (const callable of [arrow, holder.method, holder.later, later]) told.push(callable.prototype, "prototype" in callable);
for (const callable of [steps, holder.steps, holder.slow]) told.push(typeof callable.prototype, Object.hasOwn(callable.prototype, "constructor"), Object.getPrototypeOf(callable.prototype) === Object.prototype);
steps.prototype.extra = function () { return "extra"; };
let thrown = "nothing";
try { new arrow(); } catch (error) { thrown = error.constructor.name; }
console.log(told.join(), steps().extra(), steps() instanceof steps, thrown);
