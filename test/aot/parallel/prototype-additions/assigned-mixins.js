// Object.assign() from a literal that stands in a constant, or that spreads another.
const mixin = {
  held() {
    return "held";
  },
};
const more = {
  spread() {
    return "spread";
  },
};
Object.assign(Promise.prototype, mixin);
Object.assign(RegExp.prototype, { ...more, own: () => "own" });
Object.assign(Function.prototype, { ...{ inner: () => "inner" } });
console.log(Promise.resolve(1).held(), /a/.spread(), /a/.own(), (() => {}).inner());
