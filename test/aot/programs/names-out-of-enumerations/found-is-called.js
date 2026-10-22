// What the read finds is used as what flow says it is: a number, a function of the program. The witness of the win, and of the answers.
const table = { one: x => x + 1, two: x => x * 2 };
const numbers = { a: 1, b: 2, c: 3 };
function sum(o) { let total = 0; for (const name in o) total += o[name]; return total; }
function run(o, x) { let total = 0; for (const name in o) if (Object.prototype.hasOwnProperty.call(o, name)) total += o[name](x); return total; }
function copyProperties(first, second) { for (const id in second) if (Object.prototype.hasOwnProperty.call(second, id)) first[id] = second[id]; return first; }
let all = 0;
for (let i = 0; i < 1000; i++) all += sum(numbers) + run(table, i) + copyProperties({}, numbers).c;
console.log(all);
function inherited() { const o = Object.create({ up: 5 }); o.own = 6; return sum(o); }
console.log(inherited(), sum([1, 2, 3]), sum("12"));
class WithGetter { constructor() { this.x = 1; Object.defineProperty(this, "y", { get() { return 41; }, enumerable: true }); } }
console.log(sum(new WithGetter()));
function onFunction() { function f() {} f.extra = 7; return sum(f); }
console.log(onFunction());
