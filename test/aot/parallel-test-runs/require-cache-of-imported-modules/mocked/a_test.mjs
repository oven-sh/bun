import { test, vi } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { value } from "./module.mjs";
console.log("SAID imported", value);
vi.mock("./module.mjs", async importOriginal => ({ ...(await importOriginal()), value: 2 }));
test("entry", async () => {
  const require = createRequire(import.meta.url);
  const path = fileURLToPath(new URL("./module.mjs", import.meta.url));
  const say = what => {
    const entry = require.cache[path];
    console.log("SAID", what, entry && [entry.loaded, entry.parent === undefined, entry.exports.value, typeof entry.exports.read].join());
  };
  say("first");
});
