import { left } from "./cycle-left.mjs";
import late from "./late.cjs";
console.log("cycle-right runs", typeof left);
export function right() {
  return "right(" + late + ")";
}
