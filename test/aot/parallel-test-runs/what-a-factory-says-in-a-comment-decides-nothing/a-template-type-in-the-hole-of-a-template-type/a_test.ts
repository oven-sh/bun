import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    const kind: `a${`//`}` = "a//", held = { importOriginal: kind };
    globalThis.note = held;
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
