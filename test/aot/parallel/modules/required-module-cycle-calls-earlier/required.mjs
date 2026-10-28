import "./file.cjs";
import("./other.mjs").then(() => console.log("other is imported"));
console.log("required runs");
export const value = 41;
