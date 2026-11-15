import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import { held } from "./below.mjs";
console.log("text alone:", show(held.default), Object.keys(held).join());
test("runs", () => {});
