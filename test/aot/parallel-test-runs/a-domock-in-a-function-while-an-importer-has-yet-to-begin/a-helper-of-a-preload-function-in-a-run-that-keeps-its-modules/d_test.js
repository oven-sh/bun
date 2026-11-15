import { test } from "bun:test";
import { read } from "./mocks.js";
test("third", async () => console.log("SAID third", read(), (await import("./dep.js")).who()));
