import { mock } from "bun:test";
import { ask } from "./asks.mjs";
mock.module("./other.mjs", () => ({ word: "mocked" }));
console.log("SAID", ask());
