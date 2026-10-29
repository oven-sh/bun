// Everything runs once. `inner` holds what it is handed in a variable that a closure stores through.
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
