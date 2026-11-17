const { test } = require("bun:test");
let said; try { said = Object.keys(require("./shared.cjs")).join(); } catch (error) { said = "threw: " + error.message; }
test("the first", () => console.log("SAID a", said, globalThis.runs));
