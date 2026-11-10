import { mock, test, vi } from "bun:test";
import { load } from "./helper.cjs";
let inner;
vi.doMock("./kiln.mjs", async () => {
  await new Promise(done => setTimeout(done, 20));
  return { heat: "mocked kiln" };
});
vi.doMock("./glaze.cjs", () => {
  inner = import("./kiln.mjs");
  return { shade: "mocked glaze" };
});
test("a", async () => {
  const outer = import("./kiln.mjs");
  const glaze = load();
  console.log(String(glaze.shade ?? glaze.default?.shade), "|", (await inner).heat, "|", (await outer).heat, "|", globalThis.glazes ?? 0, globalThis.kilns ?? 0);
});
