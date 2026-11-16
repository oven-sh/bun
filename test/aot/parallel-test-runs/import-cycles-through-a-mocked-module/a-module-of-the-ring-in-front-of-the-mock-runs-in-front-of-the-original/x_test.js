import { test, jest } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
jest.mock("./part.js", () => { const original = jest.requireActual("./part.js"); order.push("factory " + original.seesRing()); return { part: "mock " + original.part }; });
test("t", () => console.log(`| SAID ${a()} ${order.join(" ")}`));
