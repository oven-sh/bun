import "./awaiting-cycle-a.mjs";
console.log("awaiting-cycle-b starts");
import("./awaiting-cycle-b.mjs").then(() => console.log("awaiting-cycle-b is imported"));
await null;
console.log("awaiting-cycle-b resumes");
export const b = 1;
