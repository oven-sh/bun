import defer * as c from "./c.mjs";
console.log("a starts");
console.log("a sees " + c.value);
export const value = "A".toLowerCase();
console.log("a ends");
