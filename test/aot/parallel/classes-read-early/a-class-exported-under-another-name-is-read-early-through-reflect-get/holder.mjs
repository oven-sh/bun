import { look } from "./early.mjs";
class Inner {
  run() {
    return 1;
  }
}
export { Inner as C };
console.log("behind:", look());
