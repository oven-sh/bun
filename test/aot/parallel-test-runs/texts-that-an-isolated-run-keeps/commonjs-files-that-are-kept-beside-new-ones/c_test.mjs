import { test } from "bun:test";
import "./fresh.mjs";
import "./kept.mjs";
test("one import further down", () => console.log(order.join()));
