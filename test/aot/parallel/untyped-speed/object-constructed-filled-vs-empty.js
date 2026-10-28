// An object constructed and filled is not five times as slow as an empty literal filled.
function fillConstructed(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Object();
    made.a = i & 7;
    made.b = i & 3;
    sum += made.a + made.b;
  }
  return sum;
}
function fillLiteral(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = {};
    made.a = i & 7;
    made.b = i & 3;
    sum += made.a + made.b;
  }
  return sum;
}
function fastestOf(runs, fill) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (fill(4_000_000) !== 20_000_000) console.log("a wrong sum");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
fastestOf(2, fillConstructed), fastestOf(2, fillLiteral);
const constructed = fastestOf(5, fillConstructed), literal = fastestOf(5, fillLiteral);
console.log(constructed < literal * 5 ? "under five times the time" : "over five times the time");
