import { test } from "bun:test";
import { tags } from "./settings.json";
import * as settings from "./settings.json";

test("a file that imports names of the settings has another copy", () => {
  console.log("b", tags.join(), settings.default.tags === tags, require("./settings.json").tags === tags);
});
