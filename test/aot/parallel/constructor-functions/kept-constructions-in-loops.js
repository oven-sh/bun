// What a loop constructs and keeps stands below the constructor's prototype of that moment.
function Pair(car, cdr) { this.car = car; this.cdr = cdr; }
Pair.prototype.sum = function () { return this.car + (this.cdr ? this.cdr.sum() : 0); };
const first = Pair.prototype;
const heads = new Array(8).fill(null);
function fill(n, at, change) {
  for (let i = 0; i < n; i++) {
    if (i === at) change();
    const k = i & 7;
    heads[k] = i < 8 ? new Pair(i, null) : new Pair(i, heads[k]);
  }
  return heads.map(h => [Object.getPrototypeOf(h) === first, Object.getPrototypeOf(h) === Pair.prototype, h.car, Object.keys(h).join()].join(" ")).join(" | ");
}
function Box(value) { this.value = value; if (value === 13) return { instead: value }; }
function list(n, at, change) {
  const made = [];
  for (let i = 0; i < n; i++) {
    if (i === at) change();
    made.push(new Box(i));
  }
  return made.map(b => `${b.value ?? b.instead}${b instanceof Box ? "" : "!"}${b.tag ?? ""}`).join();
}
console.log(fill(20, -1, () => {}), heads[3].sum());
console.log(list(15, -1, () => {}));
console.log(list(15, 7, () => { Box.prototype = { tag: "t" }; }));
console.log(list(5, 2, () => { Object.defineProperty(Box, "prototype", { value: Object.create(null), writable: false }); }));
console.log(fill(20, 12, () => { Pair.prototype = { other: true }; }));
console.log(fill(20, 5, () => { Pair.prototype = first; }), "sum" in heads[1]);
console.log(fill(20, 5, () => { Pair.prototype = 5; }));
const last = heads[7];
console.log(Object.getPrototypeOf(last) === Object.prototype, last.other, "sum" in last);
