import { test, vi } from "bun:test";
const note = word => { globalThis.notes = (globalThis.notes ?? "") + word + " "; };
test("no original and no factory behind the jar that cannot be copied", async () => {
  vi.doMock("./jar.cjs");
  vi.doMock("./lid.mjs", async original => {
    note("factory");
    return { ...(await original()), word: "mock lid" };
  });
  const said = [];
  for (let turn = 0; turn < 2; turn++) said.push(await import("./shelf.mjs").then(found => found.all, error => "threw " + error.message));
  console.log("SAID", globalThis.notes, "|", said.join(" | "));
});
