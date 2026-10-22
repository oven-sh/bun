// What built ins make: programs p bind four. It prints what plain Bun prints.
// @ts-nocheck
// Instructions a bind of four operands (more than a bound function holds in itself): "bind" against "none".
const binds = process.argv[2] === "bind";
const count = 200000;
function target(a, b, c, d) { return a + b + c + d; }
let kept = 0;
for (let i = 0; i < count; i++) {
  const f = binds ? target.bind(null, i, 1, 2, 3) : target;
  kept += f.length;
}
console.log(kept);
