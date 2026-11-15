import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, vi } from "vitest";
import { known } from "./entry.mjs";
vi.mock("./setter.mjs", async importOriginal => { const { set } = await importOriginal(); return { set: () => "mocked " + set() }; });
const require = createRequire(import.meta.url);
const path = fileURLToPath(new URL("./setter.mjs", import.meta.url));
const ask = read => { try { return String(read()); } catch (error) { return error.message.split(" ").slice(0, 3).join(" "); } };
const see = (label, all) => console.log("SAID", label, ask(() => all.set()), ask(() => all.left), ask(() => all.default), "left" in all, Object.keys(all).join());
test("reads", async () => {
  console.log("SAID", known());
  const entry = require.cache[path];
  see("cache", entry?.exports);
  see("required", require(path));
  console.log("SAID", entry.exports === require(path), entry.exports === (await import("./setter.mjs")));
});
