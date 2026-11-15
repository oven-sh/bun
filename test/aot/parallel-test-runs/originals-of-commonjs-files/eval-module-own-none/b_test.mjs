import { test } from "bun:test";
import * as tax from "./tax.cjs";
import { used } from "./user.mjs";
test("b", async () => { console.log("SAID next", Object.keys(tax).sort().join(), String(tax.rate)); try { console.log("SAID next", used(), String(await tax.fee?.())); } catch (error) { console.log("SAID", error.name); } });
