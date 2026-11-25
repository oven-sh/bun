import { mock } from "bun:test";
import { ask } from "./asks.mjs";
const before = ask();
mock.module("./maker.mjs", () => ({ load: (name) => "mocked " + name }));
console.log(before, "|", ask());
