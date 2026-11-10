import { test, vi } from "bun:test";
test("the import of this file never settles", async () => {
  const called = Promise.withResolvers();
  vi.doMock("./m.js", () => { called.resolve(); return new Promise(() => {}); });
  void import("./m.js");
  await called.promise;
  console.log("SAID the factory of the first file runs");
});
