structuredClone({ a: new Map() }).a.constructor.extra = 41;
function read() {
  return Map.extra;
}
console.log(read());
