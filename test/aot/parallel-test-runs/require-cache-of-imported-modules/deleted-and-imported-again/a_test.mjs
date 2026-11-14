import { test, vi } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
test("entry", async () => {
  const require = createRequire(import.meta.url);
  const path = fileURLToPath(new URL("./module.mjs", import.meta.url));
  const say = what => {
    const entry = require.cache[path];
    console.log("SAID", what, entry && [entry.loaded, entry.parent === undefined, entry.exports.value, typeof entry.exports.read].join());
  };
  await import("./module.mjs");
  say("first");
  delete require.cache[path];
  say("deleted");
  await import("./module.mjs");
  say("again");
});
