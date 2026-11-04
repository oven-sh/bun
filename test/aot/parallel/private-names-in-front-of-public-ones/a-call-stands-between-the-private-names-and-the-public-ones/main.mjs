const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const seen = [];
class Point {
  #x = 1;
  #y = unknown(look)(this);
  z = 3;
  w = 4;
  sum() {
    return this.#x + this.#y + this.z + this.w;
  }
}
function look(made) {
  seen.push(Object.keys(made).length);
  made.early = 9;
  return 2;
}
const Made = unknown(Point);
let total = 0;
for (let i = 0; i < 300; i++) total += new Made().sum();
console.log(total, Object.keys(new Made()).join(), seen.length);
