import { test, vi, mock } from "bun:test";
let calls = 0;
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const look = async step => console.log("SAID", step, "import", await tried(async () => (await import("./part.cjs")).x), "user", await tried(async () => (await import("./user.js")).seen()), "runs", JSON.stringify(globalThis.runs ?? {}), "calls", calls);
test("x", async () => {
  vi.doMock("./part.cjs", () => (calls++, ({ x: "mock" })));
  await look("mocked");
  for (const key of Object.keys(require.cache)) if (/(user|mid)\.c?js$/.test(key)) delete require.cache[key];
  await look("taken out");
  vi.doUnmock("./part.cjs");
  await look("ended");
  await look("again");
});
