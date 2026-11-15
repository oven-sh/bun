// A test run has no bundle: it answers as `bun test`, whose loader behind `import` asks the package alone and runs plain.mjs sloppy. An executable runs it strict.
import { test } from "bun:test";
import "./plain.mjs";
const again = () => require("./plain.mjs");
test("the mode of the file", () => {
  console.log(globalThis.seen.join(" "), typeof again);
});
