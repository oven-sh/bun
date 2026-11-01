import defer * as later from "./later.mjs";
console.log("before");
class Unused {
  static member = later.value;
}
console.log("after");
