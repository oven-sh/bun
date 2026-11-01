const hide = value => JSON.parse("0", () => value);
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
class Base {
  constructor(o) {
    return o;
  }
}
class V extends Base {
  #x = 5;
  y = 6;
  #m() {
    return (() => `${this.#x} ${this.y} ${this.pad}`)();
  }
  get g() {
    return this.#m();
  }
}
const v = new V(undefined);
const stamped = { pad: 1, pad2: 2, pad3: 3 };
new V(stamped);
const g = hide(Object.prototype.__lookupGetter__).call(v, "g");
const strangers = [stamped, { pad: 9 }, [5], 7];
console.log(tell(() => v.g), strangers.map(s => tell(() => g.call(s))).join(" | "));
