import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import { held } from "./below.mjs";
import near from "./conf.txt" with { type: "toml" };
console.log("toml nearer:", show(near), show(held), held === near);
test("runs", () => {});
