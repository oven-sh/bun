import { test, vi, mock, jest } from "bun:test";
const say = (...a) => console.log("SAID", ...a);
const show = p => p.then(x => x, e => e.name);
test("t", async () => {
  jest.doMock("./middle.cjs", async original => { say("g<"); const real = await original(); say("g-"); return { ...real, x: 2 }; });
  await import("./a.mjs");
  say("end");
});
