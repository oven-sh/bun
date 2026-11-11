const { test } = require("bun:test");
let said; try { said = Object.keys(require("./shared.cjs")).join(); } catch (error) { said = "threw: " + error.message; }
test("the second", () => console.log("SAID b", said, globalThis.runs));
