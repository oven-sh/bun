import { test } from "bun:test";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const file = path.join(import.meta.dir, "d.json");
const show = value => console.log(typeof value, JSON.stringify(value));
const json = async () => show((await import("./d.json", { with: { type: "json" } })).default);
const text = async () => show((await import("./d.json", { with: { type: "text" } })).default);
const required = () => show(require("./d.json"));
const entry = () => show(require.cache[file]?.exports);
test("text then json entry read before require", async () => {
  await text();
  await json();
  entry();
  required();
  required();
});
