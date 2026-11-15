// Straight arithmetic reads back elements that it has stored, off one list and off two names of one list. Under proof-checks what is remembered of an element is held against memory after the stores that the arm keeps for its end.
class Matrix {
  constructor() { this.elements = [1, 1, 0, 2]; this.weight = 2; }
  multiply(a) { const te = this.elements; te[2] = te[0] * a; return this; }
  scale(a) { const te = this.elements, ae = a.elements, be = te; te[0] = te[1] * te[3] - te[0] * ae[2]; te[2] = be[1] * ae[2]; te[3] = te[1] * te[2] - ae[1] * ae[2]; return this; }
  mix(a) {
    const te = this.elements, ae = a.elements;
    te[0] = ae[1] / te[2] + this.weight * ae[2];
    te[2] = te[1] * te[0] - ae[3] * ae[3];
    te[3] = te[2];
    te[1] = (ae[1] - ae[3]) * te[3] - ae[3] / ae[3];
    return this;
  }
}
function run(n, list) { const k = new Matrix(); for (let i = 0; i < n; i++) { const m = list[i % list.length]; m.multiply(2); m.scale(k); } return list[0].elements.join(); }
function mixed(n, list) { for (let i = 0; i < n; i++) list[i % list.length].mix(list[0]); return list.map(m => m.elements.join()).join(" "); }
function of(...elements) { const m = new Matrix(); m.elements = elements; return m; }
const accessor = new Matrix(), short = of(3, 9, 8, 9), sparse = of(3, 9, 8, 9), fixed = new Matrix();
Object.defineProperty(accessor.elements, 0, { get() { return 3; }, set(value) { }, configurable: true });
Object.defineProperty(fixed.elements, 1, { value: 3, writable: false });
short.elements.length = 2;
delete sparse.elements[1];
console.log(run(1, [new Matrix(), accessor]), run(3, [new Matrix(), fixed]), run(2, [accessor]));
console.log(mixed(2, [of(3, 9, 8, 9), short]), mixed(3, [short]), mixed(2, [sparse, of(3, 9, 8, 9), sparse]), mixed(1, [of(0.5, 9, 8, 9)]));
