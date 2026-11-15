import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, vi } from "vitest";
import { known } from "./entry.mjs";
vi.mock("./setter.mjs", () => ({ set: () => "mocked" }));
const require = createRequire(import.meta.url);
const path = fileURLToPath(new URL("./setter.mjs", import.meta.url));
const ask = read => { try { return String(read()); } catch (error) { return error.message.split(" ").slice(0, 3).join(" "); } };
const see = (label, all) => console.log("SAID", label, ask(() => all.set()), ask(() => all.left), ask(() => all.default), "left" in all, Object.keys(all).join());
test("reads", async () => {
  console.log("SAID", known());
  see("required", require(path));
  see("cache", require.cache[path]?.exports);
});
