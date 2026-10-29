import { name } from "./names.mjs";
import { value } from "./late-part.mjs";
console.log("late second runs");
export const value2 = value;
export { value2 as value };
