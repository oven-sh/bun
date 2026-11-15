import { test, vi } from "bun:test";
test("leaves an import pending and mocks the file one microtask later", async () => {
  globalThis.imports = [import("./part.mjs")];
  await Promise.resolve();
  vi.doMock("./part.mjs", () => {
    globalThis.factoryCalls = (globalThis.factoryCalls ?? 0) + 1;
    return { name: "first mock", extra: 2 };
  });
  globalThis.imports.push(import("./part.mjs"), import("./part.mjs"));
});
