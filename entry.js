export const id = "entry";
const v = await import("./entry.js");
console.log("loaded", v.id);
