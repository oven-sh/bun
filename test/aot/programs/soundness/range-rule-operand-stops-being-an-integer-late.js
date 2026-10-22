// The operand of a built-in with a range rule stops being an integer in code that is found through its result.
function main() {
let x = 1;
const steps = { 2() { x = 2.5; return 0; }, 3() { x = "7"; return 0; }, 7() { x = undefined; return 0; } };
const seen = [];
for (let i = 0; i < 4; i++) {
  const r = Math.max(x, 2);
  seen.push(r);
  const step = steps[Math.ceil(r)];
  if (step) step();
}
console.log(seen.join());
let y = -3;
const turn = { 3() { y = -0.5; }, 0.5() { y = {}; } };
const out = [];
for (let i = 0; i < 3; i++) {
  const r = Math.abs(y);
  out.push(r, (r | 0) === r);
  if (turn[r]) turn[r]();
}
console.log(out.join());
let name = "one";
const bySymbol = { [Symbol.for("one")]() { name = "two"; return 1; }, [Symbol.for("two")]: "second" };
for (let i = 0; i < 2; i++) {
  const v = bySymbol[Symbol.for(name)];
  console.log(typeof v === "function" ? v() : v.length);
}
}
main();
