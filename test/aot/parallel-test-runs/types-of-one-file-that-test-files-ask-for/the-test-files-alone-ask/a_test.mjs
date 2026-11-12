import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import conf from "./conf.txt" with { type: "toml" };
console.log("toml:", show(conf));
test("runs", () => {});
