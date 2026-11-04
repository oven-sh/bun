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
const g = hide(Object.prototype.__lookupGetter__).call(v, "g");
console.log(tell(() => g.call(7)), tell(() => g.call(null)));
