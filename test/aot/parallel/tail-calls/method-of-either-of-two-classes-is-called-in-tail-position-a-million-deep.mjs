// an object of one class or of another is chosen, and its method is called in tail position: a million calls deep the stack is as it was
class Left { step(n, sum) { const next = n % 3 ? left : right; if (!n) return sum; return next.step(n - 1, sum + 1); } }
class Right { step(n, sum) { const next = n % 2 ? left : right; if (!n) return sum; return next.step(n - 1, sum + 2); } }
const left = new Left;
const right = new Right;
function subject(c, n) { const first = c ? left : right; return first.step(n, 0); }
function deed(c, n) { return String(subject(c, n)); }
console.log(deed(true, 10), deed(false, 10), deed(0, 1), deed(1, 0));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(i % 2, i);
console.log(String(sum));
console.log(deed(JSON.parse("1"), 1000000), deed(JSON.parse("0"), 1000000));
