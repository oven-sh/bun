import { test } from "bun:test";
test("b", () => console.log("b", require("@made-up/tax").rate));
