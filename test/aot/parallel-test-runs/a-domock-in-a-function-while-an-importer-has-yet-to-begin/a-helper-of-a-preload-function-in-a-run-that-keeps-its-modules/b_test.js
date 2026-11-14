import { test } from "bun:test";
import { read } from "./mocks.js";
test("first", async () => console.log("SAID first", read(), (await import("./dep.js")).who()));
