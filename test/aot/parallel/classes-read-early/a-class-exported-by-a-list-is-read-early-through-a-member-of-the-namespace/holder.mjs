import { look } from "./early.mjs";
class C {
  run() {
    return 1;
  }
}
export { C };
console.log("behind:", look());
