import { test } from "bun:test";
import { who } from "./dep.js";
test("fourth", async () => console.log("SAID fourth", who(), (await import("./dep.js")).who()));
