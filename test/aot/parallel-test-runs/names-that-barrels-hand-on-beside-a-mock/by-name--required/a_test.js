import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", () => { const space = require("./area.mjs"); console.log("a", typeof space.area, String(space.sides), space.area(2, 3)); });
