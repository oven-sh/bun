import { test } from "bun:test";
test("b", () => console.log("b", require("./tax.mjs").rate));
