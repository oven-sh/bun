import { test, vi, mock } from "bun:test";
test("t", async () => {
  const reader = await import("./reader.cjs");
  const kept = (globalThis.kept ??= []);
  console.log("SAID", 'b', "before", await reader.read(), globalThis.runs);
  mock.module("./gauge.cjs", () => ({ word: "mock", bump: () => "m", default: { word: "mock", bump: () => "m" } }));
  console.log("SAID", 'b', "mocked", await (await import("./reader.cjs")).read(), (await import("./gauge.cjs")).word, globalThis.runs);
  vi.doUnmock("./gauge.cjs");
  const again = await import("./reader.cjs");
  console.log("SAID", 'b', "ended", await again.read(), again === reader, (await import("./gauge.cjs")).word, globalThis.runs);
  kept.push(reader, again);
  for (const each of kept) console.log("SAID", 'b', "kept", await each.read(), each.space === reader.space, each.space?.word);
});
