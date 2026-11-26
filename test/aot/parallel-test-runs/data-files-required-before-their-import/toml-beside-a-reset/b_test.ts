import { test, vi } from "bun:test";
import settings from "./settings.toml";

test("a file that imports the settings sees the change", () => {
  console.log("b", settings.tags.join(), require("./settings.toml").tags === settings.tags);
});

test("and resets its modules behind it", () => {
  vi.resetModules();
  console.log("b", require("./settings.toml").tags.join(), settings.tags.join());
});
