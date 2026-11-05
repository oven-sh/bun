console.log("required begins");
import("./other.mjs").then(() => console.log("other is imported"));
console.log("required ends");
export const value = 41;
