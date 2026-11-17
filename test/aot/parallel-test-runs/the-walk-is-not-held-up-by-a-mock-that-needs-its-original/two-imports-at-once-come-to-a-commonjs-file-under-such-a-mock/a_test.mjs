import { test, vi } from "bun:test";
test("both importers get the mock of the jar", async () => {
  vi.doMock("./lid.mjs", async original => ({ ...(await original()), word: "mock lid" }));
  vi.doMock("./jar.cjs", async original => ({ ...(await original()), word: "mock jar" }));
  const [one, two] = await Promise.all([import("./shelf.mjs"), import("./rack.mjs")]);
  console.log("SAID", one.all, "|", two.all, "|", globalThis.jars);
});
