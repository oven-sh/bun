// plain.mjs is an ES module by its extension, whatever its package says.
import { test } from "bun:test";
import "./plain.mjs";
const again = () => require("./plain.mjs");
test("the mode of the file", () => {
  console.log(globalThis.seen.join(" "), typeof again);
});
