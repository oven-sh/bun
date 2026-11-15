import { test, vi } from "bun:test";
const ask = () => { try { return String(require("./kept").x); } catch (error: any) { return error.constructor.name; } };
const ran = () => (globalThis as any).ran ?? "nothing ran";
test("the mock of wrap stands, so nothing loads what its original imports", async () => {
  const side = Promise.withResolvers<object>(), begun = Promise.withResolvers<void>();
  vi.doMock("./deep", () => { begun.resolve(); return new Promise(() => {}); });
  vi.doMock("./wrap", () => ({ w: "mock wrap" }));
  vi.doMock("./side", () => side.promise);
  void import("./deep");
  await begun.promise;
  const before = [ask(), ask()];
  side.resolve({ y: "mock side" });
  for (let job = 0; job < 40; job++) await 0;
  console.log("SAID", ...before, ask(), ran());
  vi.doUnmock("./deep");
  vi.doUnmock("./wrap");
  vi.doUnmock("./side");
});
