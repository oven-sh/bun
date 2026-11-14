// A loop that expects one of a few functions tells them by the type of the cell and the word, whether or not they have got properties.
function hooks(kind) {
  const first = x => x + 1, second = function (x) { return x * 2; }, third = (x, y = 3) => x - y;
  if (kind & 1) first.priority = 1;
  if (kind & 2) second.priority = 2;
  if (kind & 4) Object.assign(third, { priority: 3, once: false });
  if (kind & 8) Object.setPrototypeOf(second, { call: 1 });
  if (kind & 16) Object.freeze(first);
  return [first, second, third];
}
function run(list, n) {
  let total = 0;
  for (let i = 0; i < n; i++) for (const hook of list) total += hook(i) + (hook.priority || 0);
  return total;
}
for (let kind = 0; kind < 32; kind++) console.log(kind, run(hooks(kind), 50));
function mixed(list, n) {
  let total = 0;
  for (let i = 0; i < n; i++) { const hook = list[i % list.length]; total += typeof hook === "function" ? Number(hook(i)) : 1; }
  return total;
}
const several = [...hooks(0), ...hooks(7), Math.abs, parseInt, Number, hooks(2)[1].bind(null), null, { call() { return 1; } }, async () => 1, class { static x = 1; }.toString];
for (let i = 0; i < several.length; i++) { try { console.log(i, mixed([several[i], several[(i + 1) % several.length], several[0]], 40)); } catch (error) { console.log(i, error.constructor.name); } }
// One closure that is changed in the loop that calls it.
function grows(f, n) {
  let total = 0;
  for (let i = 0; i < n; i++) { total += f(i); if (i === 10) f.tag = i; if (i === 20) delete f.tag; if (i === 30) f.prototype = null; if (i === 40) Object.defineProperty(f, "name", { value: "n" }); }
  return total + f.name.length;
}
for (let i = 0; i < 4; i++) console.log(grows(function (x) { return x + i; }, 60), grows(x => x * i, 60));
// Classes, generators and methods among them.
class Base { constructor(x) { this.x = x; } static make(x) { return new this(x); } }
class Heir extends Base { static extra = 1; }
Base.later = 2;
function build(kinds, n) { let total = 0; for (let i = 0; i < n; i++) { const Kind = kinds[i % kinds.length]; total += new Kind(i).x + (Kind.later | 0) + Kind.make(1).x; } return total; }
console.log(build([Base, Heir], 50), build([Base, class extends Heir {}], 50));
function* counts(n) { for (let i = 0; i < n; i++) yield i; }
counts.label = "counts";
let yielded = 0;
for (let i = 0; i < 30; i++) for (const value of [counts, function* (n) { yield n; }][i & 1](3)) yielded += value;
console.log(yielded, counts.label);
const vm = require("node:vm");
const foreign = vm.runInNewContext("[x => x + 1, function (x) { return x * 2; }]");
foreign[0].priority = 1;
console.log(run(foreign, 50), run([hooks(1)[0], foreign[1], hooks(4)[2]], 50));
