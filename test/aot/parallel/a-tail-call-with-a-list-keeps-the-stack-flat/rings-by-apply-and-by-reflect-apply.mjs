const N = 300000;
class Sub extends Array {}
const makers = {
  plain: (n, a) => [n, a],
  frozen: (n, a) => Object.freeze([n, a]),
  holey: (n, a) => [n, a, , 1],
  named: (n, a) => Object.assign([n, a], { tag: 1 }),
  subclass: (n, a) => Sub.of(n, a),
  arrayLike: (n, a) => ({ length: 2, 0: n, 1: a }),
  typed: (n, a) => Float64Array.of(n, a),
};
function ringByApply(make) {
  function spin(n, acc) { return n === 0 ? acc : spin.apply(null, make(n - 1, acc + 1)); }
  return spin(N, 0);
}
function ringByReflect(make) {
  function spin(n, acc) { return n === 0 ? acc : Reflect.apply(spin, null, make(n - 1, acc + 1)); }
  return spin(N, 0);
}
for (const name of Object.keys(makers)) {
  for (const ring of [ringByApply, ringByReflect]) {
    let answer;
    try { answer = ring(makers[name]); } catch (e) { answer = e.constructor.name; }
    console.log(name, ring.name, String(answer));
  }
}
