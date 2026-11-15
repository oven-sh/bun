const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
class Point {
  z = 3;
  w = 4;
  #twice(n) {
    return n * 2;
  }
  sum() {
    return this.#twice(this.z) + this.w;
  }
}
const Made = unknown(Point);
let total = 0;
for (let i = 0; i < 300; i++) total += new Made().sum();
console.log(total, Object.keys(new Made()).join());
