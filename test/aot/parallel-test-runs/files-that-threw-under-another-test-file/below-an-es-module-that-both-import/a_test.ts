import { test } from "bun:test";
import * as gauge from "./middle.ts";
test("a", () => { console.log("a sees", gauge.reading); });
