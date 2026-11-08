import { vi, mock, test } from "bun:test";
const look = async (step: string) => console.log(step, (await import("./dep")).flag, "late", (await import("./user-late")).values());
test("t", async () => {
  console.log("0 start", (await import("./dep")).flag);
  mock.module("./dep", () => ({ flag: "one" }));
  await look("1 one");
  vi.doUnmock("./dep");
  await look("2 unmock");
  vi.doMock("./dep", () => ({ flag: "two" }));
  await look("3 two");
});
