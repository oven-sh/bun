import { test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)), globalThis.bodies ?? "", globalThis.calls ?? 0);
test("a", async () => {
  say("potter", await import("./potter.mjs").then(module => module.pot, error => error.message));
  vi.doMock("./tint.mjs", () => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { color: "red" }; });
  const first = await vi.importActual("./tint.mjs");
  const second = await vi.importActual("./tint.mjs");
  vi.doUnmock("./tint.mjs");
  const real = await import("./tint.mjs");
  say("one object", first === second, first === real, real.color);
});
