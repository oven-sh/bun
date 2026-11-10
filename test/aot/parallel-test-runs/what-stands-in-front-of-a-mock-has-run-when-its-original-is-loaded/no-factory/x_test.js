import { test, vi } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
vi.mock("./part.js");
test("t", () => console.log(`| SAID ${a()} ${order.join(" ")}`));
