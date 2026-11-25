import { mock, test, vi, jest } from "bun:test";
import { get } from "./part.cjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ get: () => 5 }));
  console.log("SAID under", (await import("./part.cjs")).get(), get());
  vi.doUnmock("./part.cjs");
  jest.doMock("./part.cjs", () => ({ get: () => 7 }));
  console.log("SAID behind", get(), (await import("./part.cjs")).get(), get());
});
