import { test, vi, jest, mock } from "bun:test";
const other = "./other";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    const load = (other: string) => vi.importActual(other);
    await load("./other");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
