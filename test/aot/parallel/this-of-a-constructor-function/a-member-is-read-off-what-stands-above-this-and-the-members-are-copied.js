// STATISTIC: ImageFunctionsEmitted <= 4
function init(inst) {
  const own = Object.getPrototypeOf(inst);
  console.log(typeof own.extra);
  const proto = Made.prototype;
  for (const k in proto) {
    inst[k] = proto[k];
  }
}
function Made() {
  init(this);
}
console.log(typeof new Made());
