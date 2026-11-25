import rows from "./rows.json";
const made = globalThis.neverSet ? "text" : "json";
const typed = await import("./rows.json", { with: { type: made } });
typed.default.a = 5;
const again = await import("./rows.json", { with: { type: made } });
console.log(rows.a, typed.default.a, typed.default === rows, again === typed);
