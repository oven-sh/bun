import { vi, test, afterEach } from "bun:test";
const look = async (step: string) => console.log(step, (await import("./dep")).flag, "late", (await import("./user-late")).values());
afterEach(() => { vi.doUnmock("./dep"); });
test("one", async () => {
  vi.doMock("./dep", () => ({ flag: "one" }));
  await look("1 one");
});
test("real", async () => {
  await look("2 real");
});
test("two", async () => {
  vi.doMock("./dep", () => ({ flag: "two" }));
  await look("3 two");
});
