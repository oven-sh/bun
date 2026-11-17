import { test, vi } from "bun:test";
const asked = name => { try { return String(require(name).grade); } catch (error) { return error.name; } };
require("./tongs.cjs");
test("the first file", async () => {
  const said = asked("./ore.js");
  const before = (await import("./sieve.mjs")).mesh;
  vi.doUnmock("./ore.js");
  console.log("SAID first", said, globalThis.calls, before, (await import("./sieve.mjs")).mesh);
});
