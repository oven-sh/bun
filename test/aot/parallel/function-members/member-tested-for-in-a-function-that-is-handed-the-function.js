// The test stands where the function arrives as an argument.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
function test(f) {
  return "n" in f;
}
class Tester {
  test(f) {
    return Object.hasOwn(f, "n");
  }
}
console.log(test(K), new Tester().test(K), bump());
