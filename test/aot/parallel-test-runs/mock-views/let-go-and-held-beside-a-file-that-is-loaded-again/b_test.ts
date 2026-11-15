// Both users were linked by the file before. Behind the last mock user-late.ts is loaded again and sees it. user-top.ts is only held, and keeps the real dep.ts.
import { vi, mock, test } from "bun:test";
import * as top from "./user-top";
const look = async (step: string) => console.log(step, (await import("./dep")).flag, "late", (await import("./user-late")).values(), "top", top.values());
test("b", async () => {
  await look("0 start");
  mock.module("./dep", () => ({ flag: "module1", plain: "module1" }));
  await look("1 module");
  vi.doUnmock("./dep");
  await look("2 unmock");
  vi.doMock("./dep", () => ({ flag: "two3", plain: "two3" }));
  await look("3 two");
});
