import { look, reflect } from "./first.mjs";
console.log("in front:", look(), reflect());
export class Shown {
  m() {
    return 1;
  }
}
console.log("behind:", look(), reflect());
