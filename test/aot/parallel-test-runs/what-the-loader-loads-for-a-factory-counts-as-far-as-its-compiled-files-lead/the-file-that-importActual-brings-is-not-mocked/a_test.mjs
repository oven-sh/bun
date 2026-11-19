import { test, vi } from "bun:test";
import * as helper from "./helper.mjs";
test("it gets the original", async () => {
  const begun = new Promise(done => {
    globalThis.begun = done;
  });
  vi.doMock("./second.mjs", async () => {
    const one = await vi.importActual("./first.mjs");
    globalThis.begun(one.name);
    await helper.gateOfSecond;
    return { name: "mock second" };
  });
  const nameOfFirst = "not asked";
  const second = import("./second.mjs");
  const had = await begun;
  const third = globalThis.other();
  await new Promise(done => setImmediate(done));
  helper.openSecond();
  console.log("SAID", nameOfFirst, "|", had, "|", (await third).name, "|", (await second).name);
}, 5000);
