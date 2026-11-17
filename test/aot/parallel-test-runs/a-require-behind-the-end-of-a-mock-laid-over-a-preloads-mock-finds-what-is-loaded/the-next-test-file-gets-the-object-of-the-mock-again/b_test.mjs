import { test } from "bun:test";
test("next", async () => {
  const said = [require("./g.cjs") === globalThis.got, require("./g.cjs").word, Object.prototype.toString.call(require("./g.cjs"))];
  console.log("SAID next " + said.join(" ") + " " + (globalThis.runs ?? 0));
});
