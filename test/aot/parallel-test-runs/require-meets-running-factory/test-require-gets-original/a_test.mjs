import { test, vi } from "bun:test";
import * as helper from "./helper.mjs";
test("r0", async () => {
  const begun = new Promise(done => {
    globalThis.begun = done;
  });
  vi.doMock("./first.mjs", async () => {
    await helper.gate;
    return { name: "first" };
  });
  vi.doMock("./second.mjs", () => {
    globalThis.begun();
    return { name: "second" };
  });
  const first = import("./first.mjs");
  const second = import("./second.mjs");
  await begun;
  await new Promise(done => setImmediate(done));
  try {
    console.log("SAID the test requires " + require("./first.mjs").name);
  } catch (error) {
    console.log("SAID the test requires and it threw " + error.name);
  }
  helper.open();
  const name = load => load.then(module => module.name, error => "threw " + error.name);
  console.log("SAID r0", await name(first), "|", await name(second), "|", globalThis.bodies ?? "none");
}, 5000);
