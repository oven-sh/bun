import { plugin } from "bun";
import { test } from "bun:test";
test("a call: the callback throws the first time alone", async () => {
  const asked = [];
  plugin({ name: "not yet", setup(build) {
    build.onResolve({ filter: /^\.\/src\/(helper\.js|old\.cjs)$/ }, args => {
      const first = !asked.includes(args.path);
      asked.push(args.path);
      if (first) throw new Error("not yet " + args.path);
    });
  } });
  const imported = await import("./src/helper.js").then(it => it.which, error => error.message);
  let required;
  try { required = require("./src/old.cjs").which; } catch (error) { required = error.message; }
  console.log("SAID", imported, "/", required, "|", asked.join(" "));
});
