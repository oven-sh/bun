import { test, vi } from "bun:test";
const say = () => import("./part.mjs").then(held => held.get(), error => error.name + " " + error.message);
test("t", async () => {
  console.log("SAID", await say());
  vi.doMock("./part.mjs", async original => { try { return { ...(await original()) }; } catch (error) { return { get: () => "refused " + error.name + " " + error.message }; } });
  console.log("SAID", await say());
});
