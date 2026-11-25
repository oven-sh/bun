import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require.resolve("./p.mjs");
const entry = exports => ({ id: path, filename: path, loaded: true, children: [], exports });
const say = async label => {
  const required = require("./p.mjs");
  console.log(label, "require", required.own ?? required.stored, "import", (await import("./p.mjs")).own, "runs", globalThis.runs);
};
test("the entry is deleted", async () => {
  await import("./p.mjs");
  require.cache[path] = entry({ stored: "entry" });
  await say("entry");
  delete require.cache[path];
  await say("deleted");
});
