import { test, vi } from "bun:test";
const note = word => {
  globalThis.order = (globalThis.order ?? "") + word + " ";
};
test("t", async () => {
  vi.doMock("pack", async original => {
    note("p<");
    await 0;
    note("p>");
    return { kept: "mock p" };
  });
  let all;
  try {
    all = await import("./user.mjs");
  } catch (error) {
    all = { seen: "threw " + error.message };
  }
  console.log("SAID", all.seen, "|", globalThis.order);
});
