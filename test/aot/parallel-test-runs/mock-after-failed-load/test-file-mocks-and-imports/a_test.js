// The test file holds k.js by a statement, lays the mock in its body and calls import(): the statement keeps the file, the call gets the mock.
import "./served.js"; import { x } from "./k.js"; import { test, vi } from "bun:test";
vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
const got = (await import("./k.js")).x;
test("x", () => { console.log("SAID own", x, "got", got); });
