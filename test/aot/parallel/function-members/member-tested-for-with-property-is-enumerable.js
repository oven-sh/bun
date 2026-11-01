// propertyIsEnumerable().
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
console.log(K.propertyIsEnumerable("n"), K.propertyIsEnumerable("m"), bump());
