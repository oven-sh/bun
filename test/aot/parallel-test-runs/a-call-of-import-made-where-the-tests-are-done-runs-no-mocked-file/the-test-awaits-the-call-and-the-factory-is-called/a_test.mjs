import { test, vi } from "bun:test";
test("the loom is called for", async () => {
  vi.doMock("./yarn.mjs", () => { console.log("the factory of the yarn"); return { ply: "mocked yarn" }; });
  vi.doMock("./loom.mjs", async original => ({ ...(await original()), more: 1 }));
  await import("./loom.mjs").then(it => console.log("came", it.cloth, it.more), error => console.log("failed", error.message));
});
