import { test, vi } from "bun:test";
test("a written type behind a reset", async () => {
  const ask = () => import("./words.txt", { with: { type: "text" } }).then(it => typeof it.default + " " + it.default.length, error => error.constructor.name);
  const before = await ask();
  vi.resetModules();
  const behind = await ask();
  const keys = Object.keys(require.cache).filter(key => key.includes("words.txt")).map(key => key.slice(key.lastIndexOf("words.txt")));
  console.log(`SAID ${before} | ${behind} | ${JSON.stringify(keys)}`);
});
