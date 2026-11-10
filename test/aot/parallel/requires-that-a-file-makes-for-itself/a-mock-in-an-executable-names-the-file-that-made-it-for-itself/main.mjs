import { mock } from "bun:test";
import { ask } from "./tools.mjs";
const kept = ask;
const before = kept();
mock.module("./tools.mjs", () => ({ label: "mocked" }));
console.log(before, "|", kept());
