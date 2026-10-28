import { value } from "./late-part.mjs";
import { value as second } from "./late-second.mjs";
console.log("late root runs");
export const total = value + second;
