import { test } from "bun:test";
test("t", async () => {
  const required = require("./code.toml");
  const thrown = await import("./code.toml", { with: { type: "js" } }).catch(error => error.name);
  console.log(thrown, require("./code.toml") === required);
});
