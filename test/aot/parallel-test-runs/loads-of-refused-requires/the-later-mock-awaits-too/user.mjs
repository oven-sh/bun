import { flag } from "./dep.mjs";
console.log("user.mjs runs", flag);
export const seen = () => flag;
