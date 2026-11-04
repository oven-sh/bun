const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
class Base {
  #kept = 1;
  shown = 2;
  base() {
    return this.#kept + this.shown;
  }
}
class Below extends Base {
  #more = 3;
  last = 4;
  sum() {
    return this.base() + this.#more + this.last;
  }
}
const Made = unknown(Below);
let total = 0;
for (let i = 0; i < 300; i++) total += new Made().sum();
console.log(total, Object.keys(new Made()).join());
