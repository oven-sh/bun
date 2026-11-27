import { test } from "bun:test";
test("nothing", () => console.log("SAID the test runs", globalThis.runs));
