import "./helper";
import { test } from "bun:test";
test("a", async () => { const tax = await import("./tax"); console.log("a", tax.rate, tax.fee); });
