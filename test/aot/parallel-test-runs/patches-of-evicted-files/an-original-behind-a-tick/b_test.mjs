import { test, vi, mock } from "bun:test";
test("b", async () => {
  let settled;
  const factory = new Promise(resolve => (settled = resolve));
  (0, vi.mock)("./top.mjs", async () => {
    const original = await vi.importActual("./top.mjs");
    console.log("SAID original", original.hit());
    settled();
    return { ...original, top: () => "mocked top" };
  });
  await 0;
  mock.module("./low.mjs", () => ({ low: () => "mocked low", lowName: "ml" }));
  await factory;
  const { user } = await import("./user.mjs");
  console.log("SAID b", user());
});
