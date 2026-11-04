import { look } from "./first.mjs";
console.log("in front:", look());
export class Shown {
  m() {
    return 1;
  }
}
console.log("behind:", look());
