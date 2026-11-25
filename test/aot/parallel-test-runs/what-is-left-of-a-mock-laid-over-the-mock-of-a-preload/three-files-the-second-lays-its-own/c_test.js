import { test, vi, jest, mock, afterAll } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const keys = o => Object.keys(o).sort().join("+");
const look = at => console.log("SAID", at, "| held", read(held, "who"), read(held, "other"), read(held, "more"), keys(held), "| by a name", heldUser(), "| the barrel", read(heldBarrel, "who"), read(heldBarrel, "other"), read(heldBarrel, "more"), keys(heldBarrel));
test("v", () => look("c"));
