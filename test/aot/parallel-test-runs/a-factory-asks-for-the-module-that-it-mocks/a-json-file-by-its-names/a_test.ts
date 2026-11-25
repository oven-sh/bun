// The names of the JSON file, spread.
import { test, mock } from "bun:test";
mock.module("./config.json", async () => { const real = await import("./config.json"); return { ...real, rate: "mock rate", default: { ...real.default, rate: "mock rate" } }; });
test("a", async () => { const config = await import("./config.json"); console.log("a", config.rate, config.fee, config.default.rate, config.default.fee); });
