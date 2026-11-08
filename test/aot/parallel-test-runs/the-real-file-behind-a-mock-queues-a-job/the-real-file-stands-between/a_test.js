import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked" }));
test("t", async () => {
  await import("./own.mjs");
  let said; try { said = (await import("reads")).seen(); } catch (e) { said = e.name + ": " + e.message; }
  console.log("SAID", said, "|", String(globalThis.jobs && [...globalThis.jobs].sort()), "|", [...(globalThis.order ?? [])].sort().join());
});
