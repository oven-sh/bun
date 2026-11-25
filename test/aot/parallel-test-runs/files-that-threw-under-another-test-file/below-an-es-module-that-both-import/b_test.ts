import { test } from "bun:test";
import * as gauge from "./middle.ts";
test("b", () => { console.log("b sees", gauge.reading); });
