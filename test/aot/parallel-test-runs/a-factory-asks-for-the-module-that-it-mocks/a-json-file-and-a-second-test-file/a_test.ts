// The mock ends with a_test.ts.
import { test, mock } from "bun:test";
mock.module("./config.json", async () => ({ default: { ...(await import("./config.json")).default, rate: "mock rate" } }));
test("a", async () => { const config = (await import("./config.json")).default; console.log("a", config.rate, config.fee); });
