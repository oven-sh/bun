// The factory is no longer on the stack when it requires its module.
import { test, mock } from "bun:test";
mock.module("./tax", async () => { await new Promise(resolve => setTimeout(resolve, 5)); return { ...require("./tax"), rate: "mock rate" }; });
test("a", async () => { const tax = await import("./tax"); console.log("a", tax.rate, tax.fee); });
