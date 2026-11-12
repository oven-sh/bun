import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import { read } from "./below.mjs";
console.log("toml alone:", show(read()));
test("runs", () => {});
