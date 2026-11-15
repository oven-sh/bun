// What a spread or Object.assign copies from a literal with getters and setters holds values; the literal keeps its accessors. Copies and literals meet at one place, are changed, frozen and listed.
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + d.value : "<" + !!d.get + "|" + !!d.set + ">"); }).join(" ");
let effects = 0; const attempt = (f) => { try { f(); } catch (e) { console.log(e.constructor.name); } };
function box(width, height) { return { width, get area() { effects++; return this.width * height; }, set area(v) { this.width = v / height; } }; }
function half(width) { return { width, get area() { return width; } }; }
function write(width) { return { width, set area(v) { effects += v; } }; }
function data(width, area) { return { width, area }; }
const copies = [(b) => ({ ...b }), (b) => ({ ...b, z: 1 }), (b) => ({ width: 0, ...b }), (b) => Object.assign({}, b), (b) => Object.assign({ width: 9 }, b), (b) => ({ get area() { return -1; }, ...b }), (b) => ({ ...b, get area() { return -2; } }), (b) => { const { width, ...rest } = b; return rest; }];
function sum(s) { return s.width + s.area; }
for (let k = 0; k < 24; k++) {
  const b = [box(k, 3), half(k), write(k), data(k, 2)][k & 3];
  const s = copies[k % copies.length](b);
  console.log(k, tell(b), tell(s), sum(s), effects);
  attempt(() => { b.area = 6; }); attempt(() => { s.width = 4; });
  console.log(k, tell(b), tell(s), sum(b), sum(s), JSON.stringify(s), effects);
  if (k % 5 === 0) Object.freeze(s);
  if (k % 5 === 1) attempt(() => Object.assign(s, box(k, 2)));
  if (k % 5 === 2) attempt(() => Object.defineProperty(s, "area", { get() { return 7; }, configurable: true }));
  if (k % 5 === 3) attempt(() => { delete s.area; });
  attempt(() => { s.area = k; });
  console.log(k, tell(s), sum(s), Object.keys({ ...s }).join(), effects);
}
let n = 0; for (let k = 0; k < 2000; k++) { const s = { ...box(k & 7, 3) }; n += s.width + s.area; } console.log(n, effects);
let m = 0; for (let k = 0; k < 2000; k++) { const s = Object.assign({}, box(k & 7, 3)); m += s.width + s.area; } console.log(m, effects);
