import { test } from "bun:test";
import * as tax from "./tax.cjs";
// The load of this file fails in the body of tax.cjs. Nothing else here asks for tax.cjs: whether a second request comes before or after the failure is a matter of threads, and the second runs the body again.
test("b", async () => { console.log("SAID next", Object.keys(tax).sort().join(), String(tax.rate)); try { console.log("SAID next", String(await tax.fee?.())); } catch (error) { console.log("SAID", error.name); } });
