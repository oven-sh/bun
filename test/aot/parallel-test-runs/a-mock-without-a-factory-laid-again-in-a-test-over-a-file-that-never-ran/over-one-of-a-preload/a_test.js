import { jest, test, vi } from "bun:test";
let first;
const look = step => { const own = require("./kettle.cjs"), held = require("./kitchen.cjs").kettle; first ??= own; let said; try { said = String(own.boil()); } catch (error) { said = "threw " + error.name; } console.log("SAID", step, "own is the first", own === first, "| the kitchen holds own", held === own, "| boil", said, "| brand", own.brand, "| calls", own.boil?.mock?.calls.length ?? "-", "| bodies", globalThis.boiled ?? 0); };
test("first", async () => { look(1); jest.mock("./kettle.cjs"); look(2); });
