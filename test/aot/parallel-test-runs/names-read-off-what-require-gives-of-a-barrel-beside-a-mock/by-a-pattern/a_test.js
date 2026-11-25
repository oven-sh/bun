import { test, mock } from "bun:test";
mock.module("./m.mjs", () => ({ v: "mocked" }));
test("a", () => { console.log("a", require("./user.cjs").seen()); });
