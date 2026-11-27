import { test, vi } from "bun:test";
import * as helper from "./helper.mjs";
test("the factory has ended", async () => {
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
  helper.openSecond();
  await second;
  const third = globalThis.other();
  console.log("SAID", nameOfFirst, "|", had, "|", (await third).name, "|", (await second).name);
}, 5000);
