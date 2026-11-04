function outer(swap: boolean) {
  let f = () => 1;
  const viaName = () => f();
  if (swap) f = () => 2;
  return f() + ":" + viaName();
}
function neverAssigned() {
  let g = () => 3;
  return g() + g();
}
console.log(outer(false), outer(true), neverAssigned());
