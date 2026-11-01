// Object.hasOwn().
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
console.log(Object.hasOwn(K, "n"), Object.hasOwn(K, "m"), bump());
