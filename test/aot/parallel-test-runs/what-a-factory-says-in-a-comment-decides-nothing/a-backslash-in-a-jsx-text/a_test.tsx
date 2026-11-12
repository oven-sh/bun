/** @jsxRuntime classic */
/** @jsx h */
const h = (...all: unknown[]) => all;
import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.note = () => <p>C:\dir</p>;
    await vi.importActual("./other");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
