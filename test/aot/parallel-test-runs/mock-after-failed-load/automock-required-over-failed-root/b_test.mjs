import { createRequire } from "node:module";
import { test, vi } from "bun:test";
test("t", async () => {
  console.log("SAID", "first", await import("./kiln.mjs").then(it => "came " + it.heat, error => error.message));
  vi.doMock("./kiln.mjs");
  try {
    console.log("SAID got", createRequire(import.meta.url)("./kiln.mjs").heat);
  } catch (error) {
    console.log("SAID", "second", error.message);
  }
  console.log("SAID", "third", await import("./kiln.mjs").then(it => "came " + it.heat, error => error.message));
});
