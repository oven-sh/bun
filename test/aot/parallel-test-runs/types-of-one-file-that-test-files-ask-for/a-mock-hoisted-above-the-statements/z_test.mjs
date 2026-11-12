import { test, mock, spyOn } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import near from "./conf.txt" with { type: "toml" };
import { read } from "./below.mjs";
console.log("no mock, toml first:", show(near), show(read()));
test("runs", () => {});
