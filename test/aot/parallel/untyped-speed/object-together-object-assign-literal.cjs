// Options laid over defaults with Object.assign(), beside a literal with the same three fields. A read out of the one may cost a little more than a read out of the other, not three times as much.
// COUNT: arrivals = 0
// COUNT: branches <= 2600
// COUNT: operations <= 300
// COUNT: cells <= 300
const defaults = { a: 1, b: 2 };
function withDefaults(options) {
  return Object.assign({}, defaults, options);
}
const assigned = withDefaults({ c: 3 }),
  literal = { a: 1, b: 2, c: 3 };
function ofTheLiteral() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + literal.a + literal.b + literal.c + i) | 0;
  return sum;
}
function ofTheAssigned() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + assigned.a + assigned.b + assigned.c + i) | 0;
  return sum;
}
console.log(ofTheLiteral(), ofTheAssigned(), JSON.stringify(assigned));
