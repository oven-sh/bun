import { jest, mock, test, vi } from "bun:test";
const loading = import("./fx.mjs");
mock.module("./fx.mjs", () => ({ rate: "second" }));
test("c", async () => {
  console.log("c loaded", (await loading).rate);
  mock.module("./leaf.mjs", () => ({ leaf: "mocked leaf" }));
  console.log("c fx", (await import("./fx.mjs")).rate);
  vi.doMock("./leaf.mjs", () => ({ leaf: "another leaf" }));
  console.log("c fx", (await import("./fx.mjs")).rate);
});
