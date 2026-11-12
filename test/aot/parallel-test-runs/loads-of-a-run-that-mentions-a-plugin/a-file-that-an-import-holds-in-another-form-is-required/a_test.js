import { plugin } from "bun";
import { test } from "bun:test";
import asset from "./src/note.thing";
test("require of a file that an import holds in another form", () => {
  const required = require("./src/note.thing");
  const shown = typeof required === "string" ? required : String(required?.default);
  console.log("SAID", typeof asset, typeof required, shown.split("/").pop(), typeof plugin);
});
