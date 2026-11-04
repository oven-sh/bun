// The function is a scope: its members are names.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
with (K) {
  console.log(n);
  n = 10;
}
console.log(K.n, bump());
