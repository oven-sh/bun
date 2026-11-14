import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import * as near from "./conf.txt" with { type: "toml" };
import { held } from "./below.mjs";
console.log("toml first:", show(near.default), show(held.default), Object.keys(near).join(), Object.keys(held).join(), held === near);
test("runs", () => {});
