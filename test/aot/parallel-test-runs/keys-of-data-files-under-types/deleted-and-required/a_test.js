import { test } from "bun:test";
import path from "node:path";
const names = () => Object.keys(require.cache).map(k => path.basename(k)).filter(k => k.startsWith("d.")).join(" ");
test("a", async () => {
  await import("./d.json", { with: { type: "json" } });
  await import("./d.json", { with: { type: "text" } });
  const key = require.resolve("./d.json");
  console.log(names(), key in require.cache, typeof require.cache[key]);
  delete require.cache[key];
  console.log(names() || "none", key in require.cache);
  require("./d.json");
  console.log(names(), key in require.cache);
});
