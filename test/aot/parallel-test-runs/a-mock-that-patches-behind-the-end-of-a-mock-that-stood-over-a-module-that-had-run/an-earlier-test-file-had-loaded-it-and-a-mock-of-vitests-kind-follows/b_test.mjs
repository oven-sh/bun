import { mock, test, vi, jest } from "bun:test";
const get = () => "-";
const look = async at => console.log("SAID", at, (await import("./part.mjs")).get(), (await import("./user.mjs")).seen());
test("b", async () => {
  vi.doMock("./part.mjs", () => ({ get: () => 5 }));
  await look("under");
  vi.doUnmock("./part.mjs");
  vi.doMock("./part.mjs", () => ({ get: () => 7 }));
  console.log("SAID held", get());
  await look("behind");
});
