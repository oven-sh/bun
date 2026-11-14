// The variables of a file with a direct eval that its load does not reach, while functions, methods and conversions that read them run in front of, between and behind their stores.
const printed = [];
function show(value) { return typeof value === "function" ? "function " + value.name : value !== null && typeof value === "object" ? "{" + Object.keys(value).join() + "}" : Object.is(value, -0) ? "-0" : String(value); }
function attempt(run) { try { printed.push(show(run())); } catch (error) { printed.push(error.name); } if (printed.length === 12) console.log(printed.splice(0).join(" ")); }
function evaluate(text) { return eval(text); }
function unreached(text) { first = evaluate(text); return second; }
var first, second, third, fourth, count, record, text, list;
var again;
function Pair(left, right) { this.left = left; this.right = right; }
Pair.prototype.sum = function () { return count + (this.right ? this.right.sum() : 0); };
Pair.prototype.toString = function () { return "pair of " + typeof second + record; };
Pair.prototype.valueOf = function () { return typeof count === "number" ? count : -1; };
class Holder { constructor() { this.held = typeof third; } ask(n) { return n > 0 ? this.ask(n - 1) : typeof fourth; } static all() { return [typeof first, typeof second, typeof third, typeof fourth, typeof count].join(); } }
function all() { return Holder.all() + typeof text + typeof list; }
attempt(all);
attempt(() => first(3));
attempt(() => `${new Pair(1, null)}`);
attempt(() => +new Pair(1, null));
(count = 0);
first = function (n) { count++; return n > 0 ? second(n - 1) : count; };
attempt(() => first(0));
attempt(() => first(1));
attempt(all);
attempt(() => [1, 2].map(n => first(n)).join());
second = function (n) { return n > 0 ? first(n - 1) + third(n) : n; };
attempt(() => first(1));
attempt(() => second(2));
(record = null), attempt(() => `${new Pair(1, new Pair(2, null))}`);
attempt(() => new Holder().held + new Holder().ask(2));
{
  third = function (n) { return n > 5 ? n : fourth(n + 1); };
  attempt(() => third(6));
  attempt(() => third(1));
}
if (count >= 0) fourth = function (n) { return third(n + 2) + record; };
attempt(all);
attempt(() => third(1));
for (let turn = 0; turn < 2; turn++) text = "text" + turn;
try { list = [first, second, third]; attempt(() => list.map(f => f(1)).join()); } catch (error) { attempt(() => error.name); }
attempt(() => { again = function (n) { return n > 0 ? again(n - 1) : text; }; return again(2); });
attempt(() => new Pair(1, new Pair(2, null)).sum());
Pair.prototype.sum = function () { return -count; };
attempt(() => new Pair(1, new Pair(2, null)).sum());
function main(n) { let total = 0; for (let turn = 0; turn < 3; turn++) total += first(n + turn) + new Pair(n, null).sum() + again(n).length; return total; }
for (let turn = 0; turn < 40; turn++) attempt(() => main(turn % 5));
attempt(all);
second = null;
attempt(() => first(1));
second = n => n * 2.5;
for (let turn = 0; turn < 9; turn++) attempt(() => main(turn % 5));
console.log(printed.join(" "), count);
