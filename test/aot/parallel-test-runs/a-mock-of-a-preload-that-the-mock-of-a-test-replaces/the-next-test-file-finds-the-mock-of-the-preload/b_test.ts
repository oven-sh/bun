import { test, vi, mock } from "bun:test";
const read = (held: any, name: string) => { try { return String(held[name]); } catch { return "threw"; } };
test("next", async () => {
  console.log("SAID in the next file", Object.keys(globalThis.held).sort().join("+"), "|", globalThis.held.fn(), read(globalThis.held, "kept"), read(globalThis.held, "dropped"), read(globalThis.held, "added"), read(globalThis.held, "more"));
  { const l = await import("./later.ts"); console.log("SAID later", l.names(), "|", l.values()); }
});
