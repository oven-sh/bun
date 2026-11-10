import { test, vi } from "bun:test";
const say = () => import("./dep.mjs").then(held => held.get(), error => "import refused " + error.message);
test("t", async () => {
  vi.doMock("./dep.mjs", async original => { console.log("| factory"); return { get: () => "mocked" }; });
  console.log("| " + await say());
});
