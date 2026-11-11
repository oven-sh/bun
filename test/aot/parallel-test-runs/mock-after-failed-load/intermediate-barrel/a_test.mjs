import { test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)), globalThis.calls ?? "");
test("a", async () => {
  say(await import("./potter.mjs").then(module => module.pot(), error => error.message));
  vi.doMock("./potter.mjs", () => ({ pot: () => "mocked pot" }));
  vi.doMock("./tint.mjs", () => { globalThis.calls = (globalThis.calls ?? "") + "t"; return { color: "red" }; });
  say("laid", globalThis.tintRan ?? 0);
  say((await import("./glaze.mjs")).color, (await import("./tint.mjs")).color, globalThis.tintRan ?? 0);
});
