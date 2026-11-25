import { mock } from "bun:test";
mock.module("pack", () => ({ light: "stand-in" }));
console.log("laid, runs", process.env.PACK_RUNS);
