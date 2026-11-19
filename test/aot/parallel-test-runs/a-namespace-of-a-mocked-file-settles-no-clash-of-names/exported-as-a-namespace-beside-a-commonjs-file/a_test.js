import { test, vi, mock } from "bun:test";
vi.mock("./shapes.mjs", () => ({ spare: 2 }));
const say = async (at, file) => { try { const it = await import(file); const value = it.look(); console.log("SAID", at, file, typeof value, typeof value === "object" ? String(value?.spare) : String(value), it.keys?.()); } catch (e) { console.log("SAID", at, file, e.name); } };
test("t", async () => {
  await say("under", "./named.mjs");
  await say("under", "./space.mjs");
});
