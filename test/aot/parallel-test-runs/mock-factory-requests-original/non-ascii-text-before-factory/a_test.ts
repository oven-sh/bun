import { test, vi, jest, mock } from "bun:test";
test("whether the mocked file runs", async () => {
  const greeting = "grüß dich 😀  ";
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    return { ...(await vi.importActual("./own")), value: greeting.length };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
