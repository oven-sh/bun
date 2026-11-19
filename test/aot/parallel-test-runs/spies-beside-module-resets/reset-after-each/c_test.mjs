import { test } from "bun:test";
const mail = require("./mail.cjs");

test("third file", () => {
  console.log("third file", mail.get());
});
