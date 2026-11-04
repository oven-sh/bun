import { look } from "./early.mjs";
export const C = class {
  run() {
    return 1;
  }
};
console.log("behind:", look());
