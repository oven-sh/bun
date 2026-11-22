// The same of a constructor that stores in a try: a throw leaves the block behind some of its stores, and the handler stores the rest in another order
const may = k => {
  if (k & 1) throw new RangeError("odd");
  return k;
};
class Made {
  constructor(k) {
    try {
      this.a = may(k);
      this.b = k;
    } catch {
      this.b = k;
      this.a = 9;
    }
  }
}
const out = [];
const made = k => new Made(k);
function run(k) {
  [0, 1, 2, 3].forEach(k => {
    try {
      const o = made(k);
      o.b = o.a;
      const copy = { ...o, z: 1 };
      out.push(Object.keys(copy).join("/"));
    } catch (error) {}
  });
}
for (const k of [0, 3]) {
  try {
    run(k);
  } catch (error) {}
}
console.log(out.join(" "));
