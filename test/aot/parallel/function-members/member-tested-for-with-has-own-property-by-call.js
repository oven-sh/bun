// The same method, handed the function by call, apply and bind.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
const has = Object.prototype.hasOwnProperty;
console.log(has.call(K, "n"), has.apply(K, ["n"]), has.bind(K)("n"), Reflect.apply(has, K, ["n"]), bump());
