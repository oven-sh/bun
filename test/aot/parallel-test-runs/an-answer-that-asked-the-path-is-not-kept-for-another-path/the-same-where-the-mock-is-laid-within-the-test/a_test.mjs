import { expect, test, vi } from "bun:test";
async function say(name, load) {
  try {
    const all = await load();
    console.log(name, Object.keys(all).sort().join(), String(all.n), String(all.m));
  } catch (error) {
    console.log(name, error.name + ": " + error.message);
  }
}
test("asks", async () => {
  vi.doMock("./mocked.mjs", () => ({ n: "mock", held: -1 }));
  await say("y.mjs", () => import("./y.mjs"));
  await say("x.mjs", () => import("./x.mjs"));
  await say("f.mjs", () => import("./f.mjs"));
  await say("t.mjs", () => import("./t.mjs"));
  expect(true).toBe(true);
});
