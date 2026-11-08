const { test, vi, jest } = require("bun:test");
vi.mock("./part.cjs", () => { console.log("SAID the factory runs"); throw new RangeError("made up"); });
test("t", () => console.log("SAID the test runs"));
