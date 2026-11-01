// Array subclass keeps its class: compiled answers as plain.
class L extends Array {
  sum() {
    return this.reduce((a, b) => a + b, 0);
  }
}
const l = L.of(1, 2, 3);
console.log(l.map(x => x * 2).sum(), l.length, l.concat([4]).sum(), Array.isArray(l), new L(3).length);
