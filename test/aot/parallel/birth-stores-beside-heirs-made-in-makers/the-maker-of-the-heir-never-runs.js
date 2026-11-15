function Base(a, b, c) { this.a = a; this.b = b; this.c = c; }
function make() {
  function Heir(a) { this.a = a; this.d = 1; }
  Object.setPrototypeOf(Heir.prototype, Base.prototype);
  Object.setPrototypeOf(Heir, Base);
  return Heir;
}
globalThis.table = { Make: Base };
function take(o) { return o.a + o.b + o.c; }
const n = +process.argv[2]; let sum = 0; const ring = [null, null, null, null, null, null, null, null];
for (let t = 0; t < n; t++) { const o = new globalThis.table.Make(t, t + 1, t + 2); ring[t & 7] = o; sum = (sum + take(o)) % 1000003; }
console.log(sum, typeof make);
