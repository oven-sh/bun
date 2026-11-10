import { test, vi } from "bun:test";
vi.mock("dep", async () => { await 0; return { value: () => "mocked" }; });
vi.mock("./top.mjs", async original => ({ ...(await original()) }));
test("t", async () => {
  const { own } = await import("./top.mjs");
  console.log("SAID b", own(), String(globalThis.order.filter(it => !it.startsWith("own"))));
});
