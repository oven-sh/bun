// Options laid over defaults with a spread and with Object.assign(), beside a literal with the same three fields.
// Each turn waits for the sum of the turn before: `sum = (sum + merged.a * merged.b - merged.c) | 0`. A turn over the one may cost a little more than a turn over the other, not many times as much.
const defaults = { a: 1, b: 2 };
function spread(options) {
  return { ...defaults, ...options };
}
function assign(options) {
  return Object.assign({}, defaults, options);
}
const spreadOut = spread({ c: 3 }),
  assigned = assign({ c: 3 }),
  literal = { a: 1, b: 2, c: 3 };
let sums = 0;
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofTheLiteral = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + literal.a * literal.b - literal.c) | 0;
  sums = (sums + sum) | 0;
});
const ofTheSpread = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + spreadOut.a * spreadOut.b - spreadOut.c) | 0;
  sums = (sums + sum) | 0;
});
const ofTheAssigned = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + assigned.a * assigned.b - assigned.c) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums);
console.log("a spread:", ofTheSpread < ofTheLiteral * 3 ? "under three times the time" : "over three times the time");
console.log(
  "an assignment:",
  ofTheAssigned < ofTheLiteral * 3 ? "under three times the time" : "over three times the time",
);
