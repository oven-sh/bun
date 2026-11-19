import { beforeEach, jest, test } from "bun:test";
let first;
const look = step => { const own = require("./kettle.cjs"), held = require("./kitchen.cjs").kettle; first ??= own; console.log("SAID", step, "own is the first", own === first, "| the kitchen holds own", held === own, "| kitchens", globalThis.kitchens, "| bodies", globalThis.boiled ?? 0); };
beforeEach(() => { jest.mock("./kettle.cjs"); });
test("first", () => { look(1); });
test("second", () => { look(2); });
