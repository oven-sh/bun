// An element that was just stored is asked for its truth as a number. The store reads a sum, which may be a string, as a number that it tests.
//
// Under: --aot-harden=proof-checks: the verifier judges the number itself
// Under: --aot-check=VerifyEachStage: the verifier judges the number itself
function run(a, b, n, t) {
  let s = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < n; i++) {
      a[i] += b[i];
      s += +a[i] || 1;
    }
  return s;
}
const show = x => (typeof x === "object" && x ? "o" + x.v : Object.is(x, -0) ? "-0" : String(x));
const out = [];
for (const [n, t] of [
  [3, 2],
  [8, 4],
  [7, 8],
]) {
  const a = [3.5, , 2.5, 5, 4, , 7, 6];
  const b = [8, 7, 6, 5, 4, 3, "x", 1];
  try {
    out.push(show(run(a, b, n, t)));
  } catch (error) {
    out.push(error.name);
  }
  out.push(Array.from(a, show).join(), Object.keys(a).length);
  out.push(Array.from(b, show).join());
}
console.log(out.join("\n"));
