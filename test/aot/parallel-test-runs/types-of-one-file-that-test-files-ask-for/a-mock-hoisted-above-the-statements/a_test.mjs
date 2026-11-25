import { test, mock, spyOn } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import { read } from "./below.mjs";
mock.module("./conf.txt", () => ({ default: "mocked" }));
console.log("hoisted:", show(read()));
test("runs", () => {});
