import { test } from "bun:test";
import { read } from "./mocks.js";
test("fifth", async () => console.log("SAID fifth", read(), (await import("./dep.js")).who()));
