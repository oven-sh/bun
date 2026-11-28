import { test } from "bun:test";
test("t", async () => {
  const text = require("./code.txt");
  const code = await import("./code.txt", { with: { type: "js" } });
  console.log(JSON.stringify([text.default, code.default, require("./code.txt") === text]));
});
