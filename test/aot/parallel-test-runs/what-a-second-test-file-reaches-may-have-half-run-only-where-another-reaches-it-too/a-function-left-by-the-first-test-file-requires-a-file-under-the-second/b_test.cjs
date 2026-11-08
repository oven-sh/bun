const { test } = require("bun:test");
const whole = require("./ring.cjs");
test("the second", () => console.log("SAID b", globalThis.seen, Object.keys(whole).join()));
