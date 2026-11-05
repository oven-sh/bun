import { vi, test } from "bun:test";
const look = async (step: string) => console.log(step, (await import("./dep")).flag, "late", (await import("./user-late")).values());
test("b", async () => {
  vi.doMock("./dep", () => ({ flag: "one" }));
  console.log("1 one", (await import("./dep")).flag);
  vi.doUnmock("./dep");
  await look("2 unmock");
  vi.doMock("./dep", () => ({ flag: "two" }));
  await look("3 two");
});
