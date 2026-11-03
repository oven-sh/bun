import defer * as later from "./later.mjs";
console.log("before");
function uncalled() {
  later.value;
}
console.log("after");
