import { test, vi } from "bun:test";
test("asks", async () => {
  const [actual, app] = await Promise.all([vi.importActual<any>("./config.cjs"), import("./app.ts")]);
  console.log("SAID both", actual.mode, app.mode());
});
