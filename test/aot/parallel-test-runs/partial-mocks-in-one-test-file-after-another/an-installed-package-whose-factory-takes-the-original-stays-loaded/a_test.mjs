import { test, vi } from "bun:test";
vi.mock("made-up-pkg", async original => ({ ...(await original()), extra: "a" }));
test("a", async () => {
  const dep = await import("made-up-pkg");
  console.log("| a " + dep.kind + " " + dep.extra);
});
