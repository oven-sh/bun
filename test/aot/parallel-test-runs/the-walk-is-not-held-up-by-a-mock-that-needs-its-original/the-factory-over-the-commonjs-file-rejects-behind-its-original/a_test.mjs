import { test, vi } from "bun:test";
test("the jar has run once behind two imports that fail", async () => {
  vi.doMock("./lid.mjs", async original => ({ ...(await original()), word: "mock lid" }));
  vi.doMock("./jar.cjs", async original => {
    await original();
    throw new Error("no jar");
  });
  const said = [];
  for (let turn = 0; turn < 2; turn++) said.push(await import("./shelf.mjs").then(found => found.all, error => "threw " + error.message));
  console.log("SAID", said.join(" | "), "|", globalThis.jars);
});
