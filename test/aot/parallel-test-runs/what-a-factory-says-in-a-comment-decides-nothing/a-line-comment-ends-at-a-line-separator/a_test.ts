import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    // a note     globalThis.note = { importOriginal: 1 };
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
