import { test, vi } from "bun:test";
import { ask, runs } from "./bundle.mjs";
test("a", async () => {
  Bun.plugin({ name: "p", setup() {} });
  console.log("SEEN", ask().next(), ask().next(), runs());
  vi.resetModules();
  const again = await import("./bundle.mjs");
  console.log("SEEN", again.ask().next(), ask().next(), again.runs(), runs(), again.ask === ask);
});
