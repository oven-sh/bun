import { test, vi } from "bun:test";
import * as helper from "./helper.mjs";
import "./dep.mjs";
test("it waits", async () => {
  const begun = new Promise(done => {
    globalThis.begun = done;
  });
  vi.doMock("./second.mjs", async () => {
    const one = await import("./first.mjs");
    globalThis.begun(one.name);
    await helper.gateOfSecond;
    return { name: "mock second" };
  });
  const first = import("./first.mjs");
  const second = import("./second.mjs");
  const had = await begun;
  helper.openFirst();
  const nameOfFirst = (await first).name;
  const third = globalThis.other();
  await new Promise(done => setImmediate(done));
  helper.openSecond();
  console.log("SAID", nameOfFirst, "|", had, "|", (await third).name, "|", (await second).name);
}, 5000);
