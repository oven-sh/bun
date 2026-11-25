import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import near from "./conf.txt" with { type: "toml" };
import { held } from "./below.mjs";
console.log("toml:", show(near), show(held), held === near);
test("runs", () => {});
