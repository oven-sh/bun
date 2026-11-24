import { test, vi } from "bun:test";
vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
test("t", async () => {
  const mocked = await import("./a");
  console.log("| " + mocked.a + " " + mocked.seenByB());
});
