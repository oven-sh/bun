// It sees the function without the name that the next store brings, and replaces what the file exports.
const seen = [];
Object.defineProperty(Function.prototype, "marker", {
  set(value) {
    seen.push(typeof this, String(this.default), value);
  },
  configurable: true,
});
function pick(e) {
  return e && e.marker ? e : { default: e };
}

const holder = pick(require("./exported.cjs"));
console.log(seen.join(), typeof holder, typeof holder.default, Object.hasOwn(holder.default, "marker"), holder.default.marker);
