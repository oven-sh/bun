// What is linked below the function reads its members.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
const below = Object.create(K);
class Sub extends K {}
const linked = { __proto__: K };
console.log(below.n, Sub.n, linked.n, "n" in below, bump(), below.n, Sub.n, linked.n);
