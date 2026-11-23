import { test, vi } from "bun:test";
import { slow } from "./helper.mjs";
let open;
globalThis.gate = new Promise(resolve => { open = resolve; });
const began = new Promise(resolve => { globalThis.began = resolve; });
test("the mocked file is imported while its factory waits", async () => {
  vi.doMock("./wick.mjs", slow);
  try {
    require("./lamp.mjs");
  } catch (error) {
    console.log("SAID the require " + error.name);
  }
  const second = import("./wick.mjs");
  open();
  console.log("SAID behind the gate " + (await second).width);
  console.log("SAID ran " + (globalThis.ran ?? "none"));
}, 4000);
