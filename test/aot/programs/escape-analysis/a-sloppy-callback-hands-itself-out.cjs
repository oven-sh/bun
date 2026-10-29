// The callee only calls what it gets. In sloppy code the callback finds itself in arguments.callee, and its caller in the caller property of a function.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
const callers = [f => f(1), f => f(2) + f(3), (a, f) => f(a)];
function trample(n) { const a = [n, n + 1, n + 2, n + 3]; return n > 0 ? trample(n - 1) + a[n & 3] : a[0]; }
function byArgumentsCallee(i) { return pick(callers, i & 1)(function (d) { kept.push(arguments.callee); return d + 2 * i; }); }
function byArgumentsCalleeAsSecond(i) { return pick(callers, 2)(i, function (d) { kept.push(arguments.callee); return d + 3 * i; }); }
function byArgumentsHandedOn(i) { return pick(callers, 0)(function (d) { return keepCalleeOf(arguments) + d + i; }); }
function keepCalleeOf(list) { kept.push(list.callee); return 1; }
function byThis(i) { return pick([function (f) { return f.call(f, 1); }], 0)(function (d) { kept.push(this); return d + 4 * i; }); }
let sum = 0;
for (let i = 0; i < 300; i++) { sum += byArgumentsCallee(i) + byArgumentsCalleeAsSecond(i) + byArgumentsHandedOn(i) + byThis(i); trample(20); }
if (typeof Bun !== "undefined") Bun.gc(true);
trample(60);
const before = kept.length;
let later = 0;
for (let i = 0; i < before; i++) later += kept[i](6);
console.log(sum, before, new Set(kept).size, later);
