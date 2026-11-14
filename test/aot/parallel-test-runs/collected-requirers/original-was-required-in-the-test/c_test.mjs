import { test } from "bun:test";
import { sold } from "./sale.mjs";
test("c", () => (Bun.gc(true), 0) || console.log("c", sold()));
