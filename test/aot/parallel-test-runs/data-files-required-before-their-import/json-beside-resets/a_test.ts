import { test } from "bun:test";

test("a file that requires the settings changes its own copy", () => {
  const settings = require("./settings.json");
  settings.tags.push("second");
  console.log("a", settings.tags.join());
});
