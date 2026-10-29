// `new Object()` makes what `{}` makes: the two fields that are stored next lie in slots, and nothing is looked up by name.
// COUNT: arrivals = 0
// COUNT: branches <= 2600
// COUNT: operations <= 300
// COUNT: cells <= 200
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
console.log(fillConstructed(1000), fillLiteral(1000));
