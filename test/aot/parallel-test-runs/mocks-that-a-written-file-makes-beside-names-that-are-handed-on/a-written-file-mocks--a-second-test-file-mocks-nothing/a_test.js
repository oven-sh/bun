import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
test("a", async () => {
  const made = import.meta.dir + "/made";
  mkdirSync(made, { recursive: true });
  writeFileSync(made + "/lay.mjs", 'import { mock } from "bun:test"; mock.module("../m.mjs", () => ({ v: "mocked" }));');
  await import(made + "/lay.mjs");
  const p = await import("./p.mjs");
  console.log("a", String(p.v));
});
