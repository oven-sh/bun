import { test, vi } from "bun:test";
const say = () => import("./dep.mjs").then(held => held.get(), error => "import refused " + error.message);
test("t", async () => {
  vi.doMock("./dep.mjs", async original => { console.log("| factory begins"); const seen = await original().then(() => "got", error => "refused " + error.message); return { get: () => "mocked over " + seen }; });
  console.log("| " + await say());
  console.log("| " + await say());
});
