import { mock } from "bun:test";
export function layAll() {
  try { mock.module("./lamp.mjs", () => { throw new Error("the factory throws"); }); } catch (error) { }
  mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
}
