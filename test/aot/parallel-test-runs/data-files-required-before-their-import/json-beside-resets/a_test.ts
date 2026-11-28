import { test } from "bun:test";

test("a file that requires the settings changes them", () => {
  const settings = require("./settings.json");
  settings.tags.push("second");
  console.log("a", settings.tags.join());
});
