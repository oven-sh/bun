// The object that a generator function makes inherits from the function's own `prototype`, which the program may fill or replace.
const log = [];
function* a(n) { for (let i = 0; i < n; i++) yield i; }
function* b(n) { for (let i = 0; i < n; i++) yield i; }
function* c(n) { for (let i = 0; i < n; i++) yield i; }
function* d(n) { for (let i = 0; i < n; i++) yield i; }
function sumA() { let s = 0; for (const x of a(4)) s += x; return s; }
function sumB() { let s = 0; for (const x of b(4)) s += x; return s; }
function sumC() { let s = 0; for (const x of c(4)) s += x; return s; }
function sumD() { let s = 0; for (const x of d(4)) { s += x; if (x === 1) break; } return s; }
function all(tag) { for (let i = 0; i < 200; i++) { sumA(); sumB(); sumC(); sumD(); } log.push(tag + " " + [sumA(), sumB(), sumC(), sumD()].join()); }
all("before");
a.prototype.next = function () { return { done: true, value: undefined }; };
b.prototype[Symbol.iterator] = function () { return [10, 20][Symbol.iterator](); };
c.prototype = { [Symbol.iterator]() { return [100][Symbol.iterator](); } };
d.prototype.return = function (v) { log.push("return called"); return { done: true, value: v }; };
all("after");
console.log(log.slice(0, 12).join("\n"), log.length);
