import { test } from "bun:test";
import "./through.mjs";
import * as tax from "./tax.mjs";
test("a", async () => console.log(tax.rate, (await import("./tax.mjs")).rate));
