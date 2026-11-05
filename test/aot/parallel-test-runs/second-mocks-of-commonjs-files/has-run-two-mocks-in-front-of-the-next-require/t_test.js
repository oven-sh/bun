import { test, mock } from "bun:test";
const say = (label, value) => console.log(label, typeof value, value && typeof value === "object" ? JSON.stringify(value) : String(value));
test("t", async () => {
  say("real", require("./lib.cjs"));
  mock.module("./lib.cjs", () => ({ __esModule: true, default: "d1" }));
  mock.module("./lib.cjs", () => ({ __esModule: true, default: "d2" }));
  say("first", require("./lib.cjs"));
  say("again", require("./lib.cjs"));
});
