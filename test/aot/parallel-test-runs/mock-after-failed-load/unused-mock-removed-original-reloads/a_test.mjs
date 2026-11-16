import { test, vi } from "bun:test";
const log = [];
const outcome = load => Promise.resolve(load).then(it => String(it.served ?? it.dough), error => error.message);
test("the dough fails once", async () => {
  vi.doMock("./dough.mjs", async original => {
    log.push("factory");
    return { ...(await original()) };
  });
  log.push(await outcome(import("./counter.mjs")));
  log.push(await outcome(vi.importActual("./dough.mjs")));
  vi.doUnmock("./dough.mjs");
  vi.doMock("./dough.mjs", () => ({ dough: "mocked dough" }));
  log.push(await outcome(vi.importActual("./dough.mjs")));
  console.log("SAID", log.join(" | "), globalThis.doughRan);
});
