import { test, vi, jest } from "bun:test";
vi.mock("pack/inner.mjs", { spy: true });
test("x", async () => {
  const user = await import("./user.mjs");
  console.log("SAID spied", user.look(), globalThis.runs);
  const own = await import("pack/inner.mjs");
  console.log("SAID own", own.run(), own.box.f.mock?.calls.length ?? "none", own.run.mock?.calls.length ?? "none", globalThis.runs);
  const again = await import("pack/inner.mjs");
  console.log("SAID again", typeof again.box.f.mock, again.run.mock?.calls.length ?? "none", globalThis.runs);
});
