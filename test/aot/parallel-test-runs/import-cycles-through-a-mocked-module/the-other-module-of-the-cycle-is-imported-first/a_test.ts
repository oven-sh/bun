import { test, vi } from "bun:test";
vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
test("t", async () => {
  const b = await import("./b");
  console.log("| " + b.seen());
});
