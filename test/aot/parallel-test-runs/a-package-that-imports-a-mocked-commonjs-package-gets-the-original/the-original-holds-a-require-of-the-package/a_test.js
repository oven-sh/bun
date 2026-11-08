import { test, vi } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked" }));
test("t", async () => {
  let said; try { said = (await import("reads")).seen(); } catch (e) { said = e.name + ": " + e.message; }
  console.log("SAID", said, String([...globalThis.order].filter(it => !it.startsWith("job")).sort()));
});
