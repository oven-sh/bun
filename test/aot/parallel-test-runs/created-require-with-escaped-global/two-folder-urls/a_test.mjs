import { test } from "bun:test";
import { createRequire } from "node:module";

const loadA = createRequire(new URL("./a/", import.meta.url));
const loadB = createRequire(new URL("./b/", import.meta.url));

test("each require resolves from its own folder", () => {
  console.log(loadA("./one.cjs").word, loadB("./one.cjs").word, loadA("../b/one.cjs") === loadB("./one.cjs"));
});
