import { test, vi } from "bun:test";
test("asks", async () => {
  console.log("SAID actual", (await vi.importActual<any>("./config.cjs")).mode);
  console.log("SAID again", (await vi.importActual<any>("./config.cjs")).mode, require("./app.ts").mode(), require("./config.cjs").mode);
});
