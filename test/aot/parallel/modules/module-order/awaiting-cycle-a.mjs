import "./awaiting-cycle-b.mjs";
console.log("awaiting-cycle-a starts");
await new Promise(resolve => setTimeout(resolve));
console.log("awaiting-cycle-a resumes");
export const a = 1;
