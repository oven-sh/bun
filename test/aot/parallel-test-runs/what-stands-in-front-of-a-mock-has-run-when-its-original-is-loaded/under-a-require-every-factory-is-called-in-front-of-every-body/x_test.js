import { test, jest } from "bun:test";
import { createRequire } from "node:module";
import { order } from "./log.js";
const require = createRequire(import.meta.url);
jest.mock("./part.js", () => { order.push("factory"); const original = jest.requireActual("./part.js"); return { part: "mock " + original.part }; });
test("t", () => console.log(`| SAID ${require("./a.js").a()} ${order.join(" ")}`));
