import defer * as a from "./a.mjs";
function late() {
  return a.value;
}
console.log("main begins");
setTimeout(() => console.log("timer", late()), 0);
console.log("main ends");
