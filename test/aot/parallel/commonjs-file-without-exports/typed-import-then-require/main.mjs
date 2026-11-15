const typed = await import("./plain.cjs", { with: { type: "js" } });
const imported = await import("./plain.cjs");
const required = import.meta.require("./plain.cjs");
console.log(typed === imported, required.__esModule);
