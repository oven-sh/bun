import vm from "node:vm";
import steps from "./steps.cjs";
globalThis.load = steps.load;
globalThis.busy = true;
const told = error => (typeof error === "string" ? "text " + error : error.name + " " + (error.code ?? error.message));
const shown = value => (value && typeof value === "object" ? Object.keys(value).sort().join() || "empty" : String(value));
let timeouts = 0, first = "returned";
try { new vm.Script("load()").runInThisContext({ timeout: 500 }); } catch (error) { first = told(error); if (error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") timeouts++; }
globalThis.busy = false;
let second;
try { second = "gave " + shown(steps.load()); } catch (error) { second = "threw " + told(error); }
console.log("SAID", true, timeouts > 0, second.startsWith("threw") ? 1 : 0);
console.log("SAID how", first, "|", second, "| runs", globalThis.runs);
process.exit(0);
