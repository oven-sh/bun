import { test } from "bun:test";
import { basename } from "node:path";
const tried = async load => {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log("failed", error.code ?? error.message);
  }
};
test("a", async () => {
  let calls = 0;
  Bun.plugin({
    name: "says",
    setup(build) {
      build.onResolve({ filter: /^\.\/[a-z0-9]+\.c?js$/ }, ({ path, importer }) => {
        console.log("asked", path, basename(importer));
        if (path !== "./boom.js") return;
        throw new RangeError("no");
      });
    },
  });
  await tried(() => import("./src/root.js"));
  await tried(() => import("./src/root.js"));
});
