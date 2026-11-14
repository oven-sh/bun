import { test, vi, mock } from "bun:test";
const read = (held: any, name: string) => { try { return String(held[name]); } catch { return "threw"; } };
test("t", async () => {
  console.log("SAID under the first", Object.keys(globalThis.held).sort().join("+"), "|", globalThis.held.fn(), read(globalThis.held, "kept"), read(globalThis.held, "dropped"), read(globalThis.held, "added"), read(globalThis.held, "more"));
  vi.doMock("./lib.cjs", () => ({ kept: "second kept", dropped: "second dropped", fn: () => "second fn", more: "second more" }));
  console.log("SAID under the second", Object.keys(globalThis.held).sort().join("+"), "|", globalThis.held.fn(), read(globalThis.held, "kept"), read(globalThis.held, "dropped"), read(globalThis.held, "added"), read(globalThis.held, "more"));
  { const l = await import("./later.ts"); console.log("SAID later", l.names(), "|", l.values()); }
  console.log("SAID behind a later load", Object.keys(globalThis.held).sort().join("+"), "|", globalThis.held.fn(), read(globalThis.held, "kept"), read(globalThis.held, "dropped"), read(globalThis.held, "added"), read(globalThis.held, "more"));
  vi.doUnmock("./lib.cjs");
  console.log("SAID ended", Object.keys(globalThis.held).sort().join("+"), "|", globalThis.held.fn(), read(globalThis.held, "kept"), read(globalThis.held, "dropped"), read(globalThis.held, "added"), read(globalThis.held, "more"));
});
