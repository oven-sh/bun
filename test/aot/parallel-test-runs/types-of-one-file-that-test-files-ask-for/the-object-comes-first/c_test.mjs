import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import near from "./depth.json" with { type: "yaml" };
import { held } from "./below.mjs";
console.log("yaml last:", show(near), show(held), held === near);
test("runs", () => {});
