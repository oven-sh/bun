import { test, jest } from "bun:test";
import { load } from "./helper.mjs";
test("t", async () => {
  const gate = Promise.withResolvers();
  jest.doMock("./dep.mjs", () => ({ value: () => "first" }));
  console.log(require("./dep.mjs").value());
  jest.doMock("./dep.mjs", async () => {
    await gate.promise;
    return { value: () => "second" };
  });
  console.log((await import("./dep.mjs")).value(), globalThis.ran);
  const loading = load();
  gate.resolve();
  console.log((await loading).value(), require("./dep.mjs").value(), (await import("./dep.mjs")).value(), globalThis.ran);
});
