var nativeBind = Function.prototype.bind, slice = Array.prototype.slice;
function bindTo(func, context) { return nativeBind.apply(func, slice.call(arguments, 1)); }
function join(a, b, c) { return a.length + b.length + c; }
const rows = JSON.parse("[1,9,2,8,3,7,4,6]");
function run(turns) {
  const bound = bindTo(join, null, "x");
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (rows[i & 7] > 3)
      sum += bound("ab", 1);
  }
  return sum;
}
console.log(run(1000), run(0), join("p", "qr", 1));
