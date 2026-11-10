import { createRequire } from "node:module";
import { test, vi } from "bun:test";
import "./warp.mjs";
import * as helper from "./helper.mjs";
const require = createRequire(import.meta.url);
test("the factory of the weft requires the warp", async () => {
  const state = (globalThis.state = {});
  state.gate = new Promise(open => (state.open = open));
  vi.doMock("./warp.mjs", helper.ofWarp);
  vi.doMock("./weft.mjs", () => { try { return { name: "weft with " + require("./warp.mjs").name }; } catch (error) { return { name: "weft threw " + error.name }; } });
  const warp = import("./warp.mjs");
  const weft = import("./weft.mjs");
  console.log("the weft:", (await weft).name);
  state.open();
  console.log("the warp:", (await warp).name);
});
