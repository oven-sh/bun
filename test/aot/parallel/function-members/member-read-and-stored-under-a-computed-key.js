// The key is known when the program runs.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
const key = process.argv.length > 99 ? "m" : "n";
console.log(K[key]);
K[key] = 40;
console.log(K.n, bump());
