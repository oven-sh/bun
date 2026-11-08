import { test, mock } from "bun:test";
const say = (label, value) => console.log(label, typeof value, value && typeof value === "object" ? JSON.stringify(value) : String(value));
say("real", require("./lib.cjs"));
mock.module("./lib.cjs", () => ({ __esModule: true, default: "d1" }));
say("first", require("./lib.cjs"));
mock.module("./lib.cjs", () => ({ __esModule: true, default: "d2" }));
say("second", require("./lib.cjs"));
test("t", () => {});
