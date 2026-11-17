
const first = require("./c1-part.cjs", { type: "text" });
const second = require("./c1-part.cjs");
console.log("ran", globalThis.ran ?? 0, first === second, String(JSON.stringify(second)).slice(0, 30));
