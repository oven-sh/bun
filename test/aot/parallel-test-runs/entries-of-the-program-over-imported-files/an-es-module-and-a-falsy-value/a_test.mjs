import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require.resolve("./p.mjs");
const entry = exports => ({ id: path, filename: path, loaded: true, children: [], exports });
const say = async label => {
  const required = require("./p.mjs");
  console.log(label, "require", required.own ?? required.stored, "import", (await import("./p.mjs")).own, "runs", globalThis.runs);
};
test("a falsy value is stored behind an entry", async () => {
  await import("./p.mjs");
  for (const value of [undefined, null, false, 0, "", NaN]) {
    require.cache[path] = entry({ stored: "entry" });
    await say("entry");
    require.cache[path] = value;
    await say("falsy " + String(value));
  }
});
