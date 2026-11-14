import { test } from "bun:test";
import { who } from "./dep.js";
test("second", async () => console.log("SAID second", who(), (await import("./dep.js")).who()));
