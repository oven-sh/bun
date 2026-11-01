const hide = value => JSON.parse("0", () => value);
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
const Base = hide(function (o) {
  return o;
});
class V extends Base {
  #x = 5;
  #m() {
    return (() => `${this.#x} ${this.pad}`)();
  }
  get g() {
    return this.#m();
  }
}
const v = new V({ pad: 0 });
const stamped = [1, 2, 3];
new V(stamped);
const g = Object.getOwnPropertyDescriptor(V.prototype, "g").get;
const h = hide(g);
const strangers = [stamped, { pad: 9 }, 7];
console.log(tell(() => g.call(v)), strangers.map(s => tell(() => h.call(s))).join(" | "));
