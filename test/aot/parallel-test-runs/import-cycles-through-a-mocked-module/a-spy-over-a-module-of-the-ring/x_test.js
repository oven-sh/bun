import { test, vi } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
import { seesRing } from "./part.js";
vi.mock("./part.js", { spy: true });
test("t", () => console.log(`| SAID ${a()} ${seesRing()} ${vi.isMockFunction(seesRing)} ${order.join(" ")}`));
