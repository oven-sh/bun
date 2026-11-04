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
const proto = hide(Object.getPrototypeOf)(v);
proto.fresh = "added";
proto.m = () => "replaced";
console.log(tell(() => v.fresh), tell(() => new V(1).fresh), tell(() => v.m()), tell(() => new V(1).m()));
