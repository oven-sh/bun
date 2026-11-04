function writes(way, n) {
  let a = n * 2;
  const r = way(() => a++);
  a += 10;
  return r;
}
function reads(way, n) {
  let a = n * 2;
  const r = way(() => a);
  a += 10;
  return r;
}
function overAParameter(way, n) {
  const r = way(() => n++);
  n += 10;
  return r;
}
function inTailPosition(way, n) {
  let a = n * 2;
  a += 10;
  return way(() => a++);
}
function overAnObject(way, n) {
  const o = { v: n * 2 };
  const r = way(() => o.v++);
  o.v += 10;
  return r;
}
function returnsIt(f) {
  return f;
}
function b0(f) { return f() + 0; }
function b1(f) { return f() + 1; }
function b2(f) { return f() + 2; }
function b3(f) { return f() + 3; }
function b4(f) { return f() + 4; }
function b5(f) { return f() + 5; }
function b6(f) { return f() + 6; }
function b7(f) { return f() + 7; }
function b8(f) { return f() + 8; }
function b9(f) { return f() + 9; }
function b10(f) { return f() + 10; }
function b11(f) { return f() + 11; }
function b12(f) { return f() + 12; }
function b13(f) { return f() + 13; }
const ways = [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, returnsIt];
function deep(d, a) {
  const x = a + d;
  const z = [d, x];
  return d > 0 ? deep(d - 1, x) + z[0] - d : 0;
}
const lines = [];
for (const lender of [writes, reads, overAParameter, inTailPosition, overAnObject]) {
  let sum = 0;
  for (let i = 0; i < 14; i++) sum += lender(ways[i], 1);
  const kept = lender(ways[14], 1);
  deep(60, 1);
  lines.push([lender.name, sum, kept(), kept()].join(" "));
}
console.log(lines.join("\n"));
