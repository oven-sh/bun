// Options laid over defaults with a spread and with Object.assign(), beside a literal with the same three fields.
// Each turn waits for the sum of the turn before: `sum = (sum + merged.a * merged.b - merged.c) | 0`. All three objects hold whole numbers in slots,
// so a turn looks no name up and asks nothing but whether the loop goes on: the product alone may be too large for a whole number of 32 bits.
// COUNT: arrivals = 0
// COUNT: branches <= 3200
// STATISTIC: ValuesInDouble <= 9
// STATISTIC: AccessesGuarded = 0
// STATISTIC: AccessesUnknown = 0
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
function ofTheLiteral() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + literal.a * literal.b - literal.c) | 0;
  return sum;
}
function ofTheSpread() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + spreadOut.a * spreadOut.b - spreadOut.c) | 0;
  return sum;
}
function ofTheAssigned() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + assigned.a * assigned.b - assigned.c) | 0;
  return sum;
}
console.log(ofTheLiteral(), ofTheSpread(), ofTheAssigned());
