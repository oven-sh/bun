import { plugin } from "bun";
import { test } from "bun:test";
test("a call: the callback answers the first time alone", async () => {
  const asked = [];
  plugin({ name: "once", setup(build) {
    build.onResolve({ filter: /^\.\/src\/(helper\.js|old\.cjs)$/ }, args => {
      const first = !asked.some(it => it.startsWith(args.path));
      asked.push(args.path + "=" + (first ? "swapped" : "none"));
      if (first) return { path: import.meta.dir + (args.path.endsWith(".js") ? "/src/swapped.js" : "/src/swapped.cjs") };
    });
  } });
  console.log("SAID", (await import("./src/helper.js")).which, "/", require("./src/old.cjs").which, "|", asked.join(" "));
});
