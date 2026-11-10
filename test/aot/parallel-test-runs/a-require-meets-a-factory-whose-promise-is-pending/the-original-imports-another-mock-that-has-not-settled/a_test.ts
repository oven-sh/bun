import { test, vi } from "bun:test";
const ask = () => { try { return String(require("./kept").x); } catch (error: any) { return error.constructor.name; } };
const ran = () => (globalThis as any).ran ?? "nothing ran";
test("a second mock below the original", async () => {
  let settle: (mock: object) => void = () => {};
  vi.doMock("./side", () => new Promise(resolve => { settle = resolve; }));
  vi.doMock("./kept", () => new Promise(() => {}));
  console.log("SAID", ask(), ask(), ask(), ask(), ran());
  vi.doUnmock("./kept");
  vi.doUnmock("./side");
});
