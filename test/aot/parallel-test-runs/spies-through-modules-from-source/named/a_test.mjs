import { test, vi } from "vitest";
import "./user.mjs";
test("spies", async () => {
  vi.resetModules();
  await import("./user.mjs");
  vi.resetModules();
  const { use } = await import("./user.mjs");
  const target = await import("./target.mjs");
  console.log("SAID before", await use(), await target.read("own"));
  const spy = vi.spyOn(target, "read").mockImplementation(async () => "spied");
  console.log("SAID spied", await use(), await target.read("own"), spy.mock.calls.length);
  spy.mockRestore();
  console.log("SAID after", await use(), await target.read("own"));
});
