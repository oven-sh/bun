import { test, vi } from "bun:test";
vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
test("t", async () => {
  const actual = await vi.importActual("./a");
  console.log("| " + actual.a + " " + actual.seenByB());
});
