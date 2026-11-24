import { test, vi, jest, mock } from "bun:test";
const rest = "her";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    await vi.importActual("./ot" + rest);
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
