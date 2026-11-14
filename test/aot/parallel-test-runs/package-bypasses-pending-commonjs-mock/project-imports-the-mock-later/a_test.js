import { test, vi } from "bun:test";
const say = (...words) => console.log("SAID " + words.join(" | ") + " | runs " + String(globalThis.runs) + " | factory " + String(globalThis.calls ?? 0));
const factory = () => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { default: { value: () => "mocked" }, value: () => "mocked", kind: "mocked", added: "added" }; };
test("a", async () => {
  vi.doMock("dep", factory);
  say("package", (await import("reads")).seen());
  say("project", (await import("./own.mjs")).seen());
  say("package again", (await import("reads")).seen());
  vi.doUnmock("dep");
  say("after", (await import("reads")).seen(), (await import("./own.mjs")).seen());
});
