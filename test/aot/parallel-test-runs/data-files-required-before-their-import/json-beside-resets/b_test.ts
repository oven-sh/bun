import { test } from "bun:test";
import settings from "./settings.json";

test("a file that imports the settings sees the change", async () => {
  console.log("b", settings.tags.join(), require("./settings.json") === settings);
  settings.tags.push("third");
  console.log("b", require("./settings.json").tags.join(), (await import("./settings.json")).default === settings);
});
