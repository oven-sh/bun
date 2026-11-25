import { test, vi, mock } from "bun:test";
test("t", async () => {
  const reader = await import("./reader.mjs");
  const kept = (globalThis.kept ??= []);
  console.log("SAID", 'a', "before", await reader.read(), globalThis.runs);
  vi.doMock("./gauge.cjs", () => ({ word: "mock", bump: () => "m", default: { word: "mock", bump: () => "m" } }));
  console.log("SAID", 'a', "mocked", await (await import("./reader.mjs")).read(), (await import("./gauge.cjs")).word, globalThis.runs);
  vi.doUnmock("./gauge.cjs");
  const again = await import("./reader.mjs");
  console.log("SAID", 'a', "ended", await again.read(), again === reader, (await import("./gauge.cjs")).word, globalThis.runs);
  kept.push(reader, again);
  for (const each of kept) console.log("SAID", 'a', "kept", await each.read(), each.space === reader.space, each.space?.word);
});
