import { mock, test, vi } from "bun:test";
import * as user from "./user.cjs";
const read = async () => (await import("./user.cjs")).read();
test("patched", async () => {
  mock.module("./dep.mjs", () => ({ value: () => "patch" }));
  console.log(user.read(), await read(), globalThis.evaluations);
});
test("mocked and unmocked", async () => {
  vi.doMock("./dep.mjs", () => ({ value: () => "mock" }));
  const mocked = await read();
  vi.doUnmock("./dep.mjs");
  console.log(mocked, await read(), globalThis.evaluations);
});
