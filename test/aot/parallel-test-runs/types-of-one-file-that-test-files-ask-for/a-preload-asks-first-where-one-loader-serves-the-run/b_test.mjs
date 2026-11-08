import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import { held } from "./below.mjs";
console.log("behind the preload:", show(globalThis.preloaded), show(held));
test("runs", () => {});
