const hide = value => JSON.parse("0", () => value);
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
class V {
  constructor(x) {
    this.x = x;
  }
  get g() {
    return (() => this.x)();
  }
  set s(value) {
    (() => {
      this.x = value;
    })();
  }
  m() {
    return (() => this.x)();
  }
}
const v = new V(3);
const other = { x: "t" };
const s = hide(Object.prototype.__lookupSetter__).call(v, "s");
s.call(other, "w");
console.log(tell(() => other.x), tell(() => v.x));
