import { jest, test, vi } from "bun:test";
const ask = (road: () => any) => { try { return String(road().x); } catch (error: any) { return error.constructor.name; } };
const kept = () => require("./kept"), user = () => require("./user"), made = () => jest.createMockFromModule("./user");
const ran = () => (globalThis as any).ran ?? "nothing ran";
const turn = () => new Promise(resolve => setImmediate(resolve));
test("a require() and a factory that has not settled", async () => {
  let settle: (mock: object) => void = () => {};
  vi.doMock("./kept", () => new Promise(resolve => { settle = resolve; }));
  console.log("SAID", ask(user), ask(kept), ask(user), ran());
  vi.doUnmock("./kept");
});
