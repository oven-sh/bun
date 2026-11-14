import { test, vi } from "bun:test";

test("a mock ends while a load waits for its factory", async () => {
  console.log("SAID first", (await import("./dep.mjs")).name);
  vi.doMock("./dep.mjs", async () => {
    await 0;
    return { name: "mock" };
  });
  try {
    console.log("SAID required", require("./user.mjs").read());
  } catch (error) {
    console.log("SAID refused", error.constructor.name);
  }
  vi.doUnmock("./dep.mjs");
  console.log("SAID module", (await import("./dep.mjs")).name);
});
