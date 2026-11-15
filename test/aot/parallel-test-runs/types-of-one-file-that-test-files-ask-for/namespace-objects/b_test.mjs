import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import * as near from "./conf.txt" with { type: "yaml" };
import { held } from "./below.mjs";
console.log("yaml first:", show(near.default), show(held.default), Object.keys(near).join(), Object.keys(held).join(), held === near);
test("runs", () => {});
