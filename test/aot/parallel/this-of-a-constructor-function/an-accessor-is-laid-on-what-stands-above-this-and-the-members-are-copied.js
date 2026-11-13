// STATISTIC: ImageFunctionsEmitted <= 5
function init(inst) {
  const own = Object.getPrototypeOf(inst);
  Object.defineProperty(own, "extra", { get() { return 1; }, configurable: true });
  const proto = Made.prototype;
  for (const k in proto) {
    inst[k] = proto[k];
  }
}
function Made() {
  init(this);
}
console.log(new Made().extra);
