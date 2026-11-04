// The store says nothing and the function has no such name of its own.
Object.defineProperty(Function.prototype, "marker", { value: 0, writable: false, configurable: true });
function pick(e) {
  return e && e.marker ? e : { default: e };
}

const holder = pick(require("./exported.cjs"));
console.log(typeof holder, typeof holder.default, Object.hasOwn(holder.default, "marker"), holder.default.marker);
