import { test, vi } from "bun:test";
test("t", async () => {
  console.log("SAID", "first", await import("./kiln.mjs").then(it => "came " + it.heat, error => error.message));
  vi.doMock("./kiln.mjs");
  console.log("SAID", "second", await import("./kiln.mjs").then(it => "came " + it.heat, error => error.message));
  console.log("SAID", "third", await import("./kiln.mjs").then(it => "came " + it.heat, error => error.message));
  vi.doUnmock("./kiln.mjs");
  console.log("SAID", "fourth", await import("./kiln.mjs").then(it => "came " + it.heat, error => error.message));
});
