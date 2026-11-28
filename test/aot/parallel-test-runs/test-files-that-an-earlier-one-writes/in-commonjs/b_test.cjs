const { test } = require("bun:test");
const { bump } = require("./app.ts");
test("b", () => console.log("SAID old", bump()));
