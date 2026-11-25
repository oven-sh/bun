import { test, vi } from "bun:test";
test("asks", async () => {
  console.log("SAID actual", (await vi.importActual<any>("./config.cjs")).mode);
});
