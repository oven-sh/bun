import { test, vi, jest, mock } from "bun:test";
setTimeout(() => {}, 0);
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    await vi.importActual(other);
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
const other = "./other";
