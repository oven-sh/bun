import { vi, test, afterEach } from "bun:test";
const look = async (step: string) => console.log(step, (await import("./dep")).flag, "late", (await import("./user-late")).values());
afterEach(() => { vi.doUnmock("./dep"); });
for (const name of ["one", "two", "three"]) {
  test(name, async () => {
    vi.doMock("./dep", () => ({ flag: name }));
    await look(name);
  });
  test(name + ", real", async () => {
    await look(name + ", real");
  });
}
