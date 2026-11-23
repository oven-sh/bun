import { test, vi } from "bun:test";
let open;
globalThis.gate = new Promise(resolve => { open = resolve; });
const began = new Promise(resolve => { globalThis.began = resolve; });
test("the mocked file is imported while its factory waits", async () => {
  vi.doMock("./wick.mjs", async () => {
    globalThis.began();
    await globalThis.gate;
    return { width: "mock" };
  });
  try {
    require("./lamp.mjs");
  } catch (error) {
    console.log("SAID the require " + error.name);
  }
  const second = import("./wick.mjs");
  console.log("SAID before the gate opens " + (await second).width);
  open();
  console.log("SAID ran " + (globalThis.ran ?? "none"));
}, 4000);
