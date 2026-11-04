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
  #put(value) {
    (() => {
      this.#x = value;
      this.z = value;
    })();
  }
  set s(value) {
    this.#put(value);
  }
  get g() {
    return this.#x;
  }
}
const v = new V(undefined);
const stamped = { pad: 1, pad2: 2, pad3: 3 };
new V(stamped);
const s = hide(Object.prototype.__lookupSetter__).call(v, "s");
const g = hide(Object.prototype.__lookupGetter__).call(v, "g");
s.call(stamped, 8);
console.log(tell(() => g.call(stamped)), tell(() => stamped.z), tell(() => stamped.pad), tell(() => v.g), tell(() => s.call({ pad: 1 }, 9)));
