// The keys of an object that got them in another order than its layout declares are seen by nothing: Object.freeze goes through the keys and shows no order.
// Under: --aot-testing=CheckProofsAtRunTime: LinkedLayout::keysMayBeListed
function make(flip) {
  const o = { kind: "point" };
  if (flip) {
    o.y = 2;
    o.x = 1;
  } else {
    o.x = 1;
    o.y = 2;
  }
  return o;
}
function deed(o) {
  Object.freeze(o);
  return String(o.x) + String(o.y) + String(Object.isFrozen(o));
}
console.log(deed(make(true)));
console.log(deed(make(false)));
function through(o) {
  return deed(o);
}
console.log(through(make(true)), through(make(false)));
let last = "";
for (let i = 0; i < 300; i++) last = deed(make(i % 2 === 0)) + "|" + deed(make(i % 2 === 1));
console.log(last);
