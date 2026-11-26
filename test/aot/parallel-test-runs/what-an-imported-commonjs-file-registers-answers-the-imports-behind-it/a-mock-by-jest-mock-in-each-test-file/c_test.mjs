import { test } from "bun:test";
import "./helper.cjs";
import { seen } from "./user.mjs";
import * as tax from "./tax.mjs";
test("c", async () => console.log(seen(), tax.rate, (await import("./tax.cjs")).rate, require("./tax.mjs").rate));
