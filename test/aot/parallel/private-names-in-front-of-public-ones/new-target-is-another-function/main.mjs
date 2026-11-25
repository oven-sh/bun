const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
class Point {
  #x = 1;
  z = 3;
  sum() {
    return this.#x + this.z;
  }
}
function Other() {}
Other.prototype.marked = true;
const Made = unknown(Point);
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = i % 3 ? new Made() : Reflect.construct(Made, [], Other);
  total += Point.prototype.sum.call(made) + (made.marked ? 10 : 0);
}
console.log(total);
