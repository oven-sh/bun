// Assorted, one probe of many. It prints what plain Bun prints.
const kept = [];
function two(a, b) {
  kept.push(b);
  return a.n;
}
function viaApply(p, q) {
  return two.apply(null, [p, q]);
}
function viaCall(p, q) {
  return two.call(null, p, q);
}
function viaSpread(p, q) {
  return two(...[p, q]);
}
function viaBind(p, q) {
  return two.bind(null, p)(q);
}
function direct(p, q) {
  return two(p, q);
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  const p = { n: i };
  const q = { n: i + 1 };
  sum += viaApply(p, q) + viaCall(p, q) + viaSpread(p, q) + viaBind(p, q) + direct(p, q);
}
console.log(sum, kept.length);
