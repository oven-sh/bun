// One reader for a function and for a literal.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
function read(from) {
  return from.n;
}
console.log(read(K), read({ n: 5 }), bump(), read(K));
