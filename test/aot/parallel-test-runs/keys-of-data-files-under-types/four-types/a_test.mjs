import { test } from "bun:test";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const file = path.join(import.meta.dir, "d.json");
const show = value => console.log(typeof value, JSON.stringify(value));
const required = () => show(require("./d.json"));
const entry = () => show(require.cache[file]?.exports);
const keys = () => console.log(Object.keys(require.cache).map(key => path.basename(key)).filter(key => key.startsWith("d.")).join(" "));
test("four types", async () => {
  for (const type of ["text", "json", "toml", "yaml"]) {
    try {
      show((await import("./d.json", { with: { type } })).default);
    } catch (error) {
      console.log(type, error.name);
    }
  }
  keys();
  entry();
  required();
});
