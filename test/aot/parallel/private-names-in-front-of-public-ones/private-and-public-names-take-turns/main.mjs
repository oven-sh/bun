const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
class Point {
  a = 1;
  #x = 2;
  b = 3;
  #y = 4;
  c = 5;
  sum() {
    return this.a + this.#x + this.b + this.#y + this.c;
  }
}
const Made = unknown(Point);
let total = 0;
for (let i = 0; i < 300; i++) total += new Made().sum();
console.log(total, Object.keys(new Made()).join());
