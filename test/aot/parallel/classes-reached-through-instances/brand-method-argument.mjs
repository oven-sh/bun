const hide = value => JSON.parse("0", () => value);
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
function helper(o) {
  return o.y;
}
class V {
  #x = 3;
  y = 4;
  #m() {
    return helper(this);
  }
  get g() {
    return this.#m();
  }
}
const v = new V();
const g = hide(Object.prototype.__lookupGetter__).call(v, "g");
const strangers = [{ x: "t" }, { pad: 1, pad2: 2, pad3: 3 }, [5], 7, null, function () {}, Object.create(v)];
console.log(tell(() => v.g), strangers.map(s => tell(() => g.call(s))).join(" | "));
