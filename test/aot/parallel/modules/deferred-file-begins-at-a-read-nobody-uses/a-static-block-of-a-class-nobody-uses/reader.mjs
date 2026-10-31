import defer * as later from "./later.mjs";
console.log("before");
class Unused {
  static {
    later.value;
  }
}
console.log("after");
