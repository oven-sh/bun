import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import conf from "./conf.txt" with { type: "text" };
console.log("text:", show(conf));
test("runs", () => {});
