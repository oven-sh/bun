import { test, vi } from "bun:test";
const ask = () => { try { return String(require("./kept").x); } catch (error: any) { return error.constructor.name; } };
test("an import() behind a require() that gave up", async () => {
  vi.doMock("./side.cjs", async () => ({ y: "mock side" }));
  vi.doMock("./kept", () => new Promise(() => {}));
  const gaveUp = ask();
  console.log("SAID", gaveUp, (await import("./side.cjs")).y);
  vi.doUnmock("./kept");
});
