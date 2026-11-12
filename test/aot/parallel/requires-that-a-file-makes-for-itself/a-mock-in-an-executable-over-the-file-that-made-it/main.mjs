import { mock } from "bun:test";
mock.module("./maker.mjs", () => ({ load: (name) => "mocked " + name }));
const { ask } = await import("./asks.mjs");
console.log(ask());
