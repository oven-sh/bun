const { test } = require("bun:test");
globalThis.look = () => Object.keys(require("./ring.cjs")).join();
test("the first", () => console.log("SAID a", typeof globalThis.look));
