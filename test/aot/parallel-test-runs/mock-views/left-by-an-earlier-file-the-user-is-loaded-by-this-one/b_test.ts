import { vi, test } from "bun:test";
const look = async (step: string) => console.log(step, (await import("./dep")).flag, "late", (await import("./user-late")).values());
test("b", async () => {
  await look("0 start");
  vi.doMock("./dep", () => ({ flag: "two" }));
  await look("1 two");
});
