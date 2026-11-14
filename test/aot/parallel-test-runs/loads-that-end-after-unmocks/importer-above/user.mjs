import { value } from "./dep.mjs";
console.log("user runs", value);
export const seen = () => "user " + value;
