// The method that every object inherits.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
console.log(K.hasOwnProperty("n"), K.hasOwnProperty("m"), bump());
