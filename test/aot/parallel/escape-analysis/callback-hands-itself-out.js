// The callee only calls what it gets. The callback itself lets the callback out: by its own name, by a variable of its maker that holds it.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
const callers = [f => f(1), f => f(2) + f(3), (a, f) => f(a)];
function trample(n) { const a = [n, n + 1, n + 2, n + 3]; return n > 0 ? trample(n - 1) + a[n & 3] : a[0]; }
function byItsName(i) { return pick(callers, i & 1)(function self(d) { kept.push(self); return d + i; }); }
function byItsNameAsSecond(i) { return pick(callers, 2)(i, function self(d) { kept.push(self); return d + 3 * i; }); }
function byItsNameInTailPosition(i) { return callers[i & 1](function self(d) { kept.push(self); return d + 4 * i; }); }
function byAnInnerCallback(i) { return pick(callers, i & 1)(function self(d) { return pick(callers, 0)(() => { kept.push(self); return d + 5 * i; }); }); }
function recursive(i) { return pick(callers, 0)(function self(d) { return d > 4 ? (kept.push(self), d) : self(d + 1) + i; }); }
function withAProperty(i) { return pick(callers, 0)(function self(d) { self.seen = (self.seen ?? 0) + d + i; kept.push(self); return self.seen; }); }
let sum = 0;
for (let i = 0; i < 300; i++) {
  sum += byItsName(i) + byItsNameAsSecond(i) + byItsNameInTailPosition(i) + byAnInnerCallback(i) + recursive(i) + withAProperty(i);
  trample(20);
}
if (typeof Bun !== "undefined") Bun.gc(true);
trample(60);
const before = kept.length;
let later = 0;
for (let i = 0; i < before; i++) later += kept[i](6);
console.log(sum, before, new Set(kept).size, later, kept.filter(f => typeof f.seen === "number").length);
