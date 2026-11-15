import { test, vi, jest, mock } from "bun:test";
const helper = { importActual: (name: string) => (made: unknown, context?: unknown) => void name };
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    @helper.importActual("./other")
    class Holder {}
    void Holder;
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
