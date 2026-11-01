// The read has two receivers.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
function L() {}
L.n = 100;
const either = process.argv.length > 99 ? L : K;
either.n += 10;
console.log(K.n, L.n, bump());
