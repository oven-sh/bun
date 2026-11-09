import defer * as late from "./late.mjs";
export const touch = () => late.value;
export const ok = true;
console.log("keeper runs");
