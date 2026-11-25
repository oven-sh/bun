import text from "./u2-part.cjs" with { type: "text" };

const second = import.meta.require("./u2-part.cjs");
console.log("ran", globalThis.ran ?? 0, text.length, String(JSON.stringify(second)).slice(0, 30));
