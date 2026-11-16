import { test, vi } from "bun:test";
import * as barrel from "./barrel.ts";
test("b", async () => {
  console.log("one b0 " + barrel.get());
  vi.doMock("./api.mjs", () => ({ get: () => "test", other: () => "test" }));
  const again: any = await import("./barrel.ts");
  console.log("one b1 " + again.get());
});
