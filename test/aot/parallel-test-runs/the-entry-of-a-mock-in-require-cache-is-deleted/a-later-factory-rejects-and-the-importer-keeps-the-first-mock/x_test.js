import { test, vi, mock } from "bun:test";
let first = 0, second = 0;
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const look = async step => console.log("SAID", step, "import", await tried(async () => (await import("./part.js")).x), "require", await tried(() => import.meta.require("./part.js").x), "user", await tried(async () => (await import("./user.js")).seen()), "runs", globalThis.runsOfPart, "calls", first, second);
test("x", async () => {
  vi.doMock("./part.js", () => (first++, { x: "first" }));
  await look("mocked");
  for (const key of Object.keys(require.cache)) if (key.endsWith("part.js")) delete require.cache[key];
  await look("taken out");
  vi.doMock("./part.js", async () => { second++; await 0; throw new Error("late boom"); });
  await look("third");
  await look("again");
});
