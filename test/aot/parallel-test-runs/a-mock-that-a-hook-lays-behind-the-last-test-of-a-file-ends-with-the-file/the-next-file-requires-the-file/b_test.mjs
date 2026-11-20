import { test } from "bun:test";

test("requires the anchor", () => {
  const { weight, chain } = require("./anchor.cjs");
  console.log("second:", weight, chain);
});
