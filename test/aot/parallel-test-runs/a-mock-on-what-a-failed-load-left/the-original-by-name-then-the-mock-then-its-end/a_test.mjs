import { test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)), globalThis.bodies ?? "", globalThis.calls ?? 0);
test("a", async () => {
  say("potter", await import("./potter.mjs").then(module => module.pot, error => error.message));
  vi.doMock("./tint.mjs", () => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { color: "red" }; });
  say("actual", (await vi.importActual("./tint.mjs")).color);
  say("mocked", (await import("./tint.mjs")).color);
  say("actual again", (await vi.importActual("./tint.mjs")).color);
  vi.doUnmock("./tint.mjs");
  say("behind the end", (await import("./tint.mjs")).color);
});
