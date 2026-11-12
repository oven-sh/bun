const { test } = require("bun:test"); const user = require("./user.cjs"); test("the second", () => console.log("SAID b", user.said));
