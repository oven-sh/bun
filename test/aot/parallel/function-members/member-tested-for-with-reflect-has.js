// Reflect.has().
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
console.log(Reflect.has(K, "n"), Reflect.has(K, "m"), bump());
