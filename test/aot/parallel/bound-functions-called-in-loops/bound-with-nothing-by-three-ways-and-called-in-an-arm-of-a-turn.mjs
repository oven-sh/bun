function join(a, b, c) { return a.length + b.length + c; }
const rows = JSON.parse("[1,9,2,8,3,7,4,6]");
function run(make, turns) {
  const bound = make();
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (rows[i & 7] > 3)
      sum += bound("x", "ab", 1);
  }
  return sum;
}
function byCall(turns) { const bound = Function.prototype.bind.call(join, null); let sum = 0; for (let i = 0; i < turns; i++) { if (rows[i & 7] > 3) sum += bound("x", "ab", 1); } return sum; }
function byApply(turns) { const bound = Function.prototype.bind.apply(join, [null]); let sum = 0; for (let i = 0; i < turns; i++) { if (rows[i & 7] > 3) sum += bound("x", "ab", 1); } return sum; }
function byReflect(turns) { const bound = Reflect.apply(Function.prototype.bind, join, [null]); let sum = 0; for (let i = 0; i < turns; i++) { if (rows[i & 7] > 3) sum += bound("x", "ab", 1); } return sum; }
console.log(byCall(100), byApply(100), byReflect(100), byCall(0), byApply(0), byReflect(0), run(() => join.bind(null), 100), join("p", "qr", 1));
