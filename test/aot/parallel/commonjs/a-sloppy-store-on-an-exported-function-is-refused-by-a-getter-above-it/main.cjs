Object.defineProperty(Function.prototype, "marker", { get() { return 0; }, configurable: true });
function pick(e) {
  return e && e.marker ? e : { default: e };
}

const holder = pick(require("./exported.cjs"));
console.log(typeof holder, typeof holder.default, Object.hasOwn(holder.default, "marker"), holder.default.marker);
