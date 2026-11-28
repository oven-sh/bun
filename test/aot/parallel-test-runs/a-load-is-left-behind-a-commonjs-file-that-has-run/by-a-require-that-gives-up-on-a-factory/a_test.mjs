import { test, vi } from "bun:test";
const tried = async load => {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log("failed", error.code ?? error.message);
  }
};
const spinEventLoop = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
};
test("a", async () => {
  const gate = Promise.withResolvers();
  vi.doMock("./late.mjs", () => gate.promise);
  await tried(() => require("./root.mjs"));
  gate.resolve({ w: "mock" });
  await spinEventLoop();
  console.log("nothing more has run");
  await tried(() => import("./root.mjs"));
  await tried(() => require("./root.mjs"));
});
