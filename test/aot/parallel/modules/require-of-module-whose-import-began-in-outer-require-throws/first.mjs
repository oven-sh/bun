import "./file.cjs";
import("./wanted.mjs").then(() => console.log("wanted is imported"));
console.log("first runs");
