import "./helper";
import { test } from "bun:test";
test("b", async () => { const tax = await import("./tax"); console.log("b", tax.rate, tax.fee); });
