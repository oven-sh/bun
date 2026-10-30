// `inner` holds what it is handed in a variable of its scope, and a closure over the scope stores through the variable. The object does not outlive the call, and
// still it is changed when the call returns: to `outer`, which made it and has handed it to nobody else, and which is two calls away from the store.
function outer() {
  const o = { x: 0 };
  middle(o);
  return o.x;
}
function middle(o) { inner(o); }
function inner(q) {
  let p = null;
  function change() { p.x = 1; }
  p = q;
  change();
}
console.log(outer());

// The same where every function runs several times.
function outerAgain(start) {
  const o = { x: start };
  middleAgain(o);
  return o.x;
}
function middleAgain(o) { innerAgain(o); }
function innerAgain(q) {
  let p = null;
  function change() { p.x += 1; }
  p = q;
  change();
}
const seen = [];
for (let i = 0; i < 5; i++) seen.push(outerAgain(i * 10));
console.log(seen.join());

// Three calls away, and the value before the call is not a constant.
function far(n) {
  const o = { x: n, y: n * 2 };
  one(o);
  return o.x + o.y;
}
function one(o) { two(o); }
function two(o) { three(o); }
function three(q) {
  let p = null;
  const change = () => { p.y = p.x + 100; };
  p = q;
  change();
}
console.log(far(1), far(2));
