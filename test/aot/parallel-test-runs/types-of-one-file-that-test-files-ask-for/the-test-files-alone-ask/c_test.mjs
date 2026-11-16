import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import conf from "./conf.txt" with { type: "yaml" };
console.log("yaml:", show(conf));
test("runs", () => {});
