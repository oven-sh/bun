import { name } from "./ring";

console.log("tax");
export const constant = "real";
export let variable = "real";
export var old = "real";
export function declared() {
  return "real " + name;
}
export class Made {
  is = "real";
}
const inside = "real";
export { inside as renamed };
export default "real";
