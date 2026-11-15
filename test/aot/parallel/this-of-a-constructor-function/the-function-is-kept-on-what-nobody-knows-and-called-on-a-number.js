function init(inst) {
  const own = Object.getPrototypeOf(inst);
  console.log(typeof own.toExponential === "function" ? own.toExponential.call(5, 1) : "none");
}
function Made() {
  init(this);
}
console.log(typeof new Made());
const held = JSON.parse("{}");
held.m = Made;
held.m.call(5);
