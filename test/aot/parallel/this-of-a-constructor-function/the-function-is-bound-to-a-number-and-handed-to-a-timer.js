function init(inst) {
  const own = Object.getPrototypeOf(inst);
  console.log(typeof own.toExponential === "function" ? own.toExponential.call(5, 1) : "none");
}
function Made() {
  init(this);
}
console.log(typeof new Made());
setTimeout(Made.bind(5), 1);
