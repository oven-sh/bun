import { mock, test, vi } from "bun:test";
import { load } from "./helper.cjs";
let inner;
const gate = Promise.withResolvers();
mock.module("./kiln.mjs", async () => {
  await gate.promise;
  return { heat: "mocked kiln" };
});
mock.module("./glaze.cjs", () => {
  inner = import("./kiln.mjs");
  return { shade: "mocked glaze" };
});
test("a", async () => {
  const outer = import("./kiln.mjs");
  const glaze = load();
  gate.resolve();
  console.log(String(glaze.shade ?? glaze.default?.shade), "|", (await inner).heat, "|", (await outer).heat, "|", globalThis.glazes ?? 0, globalThis.kilns ?? 0);
});
