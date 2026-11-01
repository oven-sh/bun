// `"n" in K` answers no value and still sees the property.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
console.log("n" in K, "m" in K, bump());
