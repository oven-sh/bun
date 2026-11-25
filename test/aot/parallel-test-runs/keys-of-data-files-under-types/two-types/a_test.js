import { test } from "bun:test";
import path from "node:path";
test("the keys of a data file under two types", async () => {
  await import("./d.json", { with: { type: "json" } });
  await import("./d.json", { with: { type: "text" } });
  console.log(Object.keys(require.cache).map(k => path.basename(k)).filter(k => k.startsWith("d.")).join(" "));
});
