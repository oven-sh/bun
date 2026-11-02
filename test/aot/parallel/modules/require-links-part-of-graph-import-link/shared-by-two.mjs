import { base, name } from "./file.cjs";
console.log("shared by two runs");
export const value = base + name.length;
