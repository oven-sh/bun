Map.groupBy = function () {
  return "first";
};
structuredClone({ a: new Map() }).a.constructor.groupBy = function () {
  return "second";
};
function read() {
  return Map.groupBy();
}
console.log(read());
