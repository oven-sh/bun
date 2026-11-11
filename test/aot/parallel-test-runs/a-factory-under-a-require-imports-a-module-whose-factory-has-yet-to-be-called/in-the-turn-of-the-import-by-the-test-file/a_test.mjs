import { mock, test, vi } from "bun:test";
import { load } from "./helper.cjs";
let inner;
mock.module("./kiln.mjs", async () => {
  await new Promise(done => setTimeout(done, 20));
  return { heat: "mocked kiln" };
});
mock.module("./glaze.cjs", () => {
  inner = import("./kiln.mjs");
  return { shade: "mocked glaze" };
});
test("a", async () => {
  const outer = import("./kiln.mjs");
  const glaze = import.meta.require("./glaze.cjs");
  console.log(String(glaze.shade ?? glaze.default?.shade), "|", (await inner).heat, "|", (await outer).heat, "|", globalThis.glazes ?? 0, globalThis.kilns ?? 0);
});
